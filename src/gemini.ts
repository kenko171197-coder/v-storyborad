import { GoogleGenAI, Type } from '@google/genai';
import {
  MAX_ACTIONS_PER_STORYBOARD,
  MAX_TOTAL_SEC,
  MIN_TOTAL_SEC,
  activeBible,
  applyBible,
  buildRefs,
  mentionsToTokens,
  describePreviousBeat,
  normalizeGenerated,
  normalizePlan,
  refCharacters,
  detectRefIds,
  timeline,
  fmtSec,
} from './assemble.ts';
import { activeApiKey, activeModel, envApiKey } from './settings.ts';
import type {
  AspectRatio,
  BeatSequence,
  Character,
  GeneratedData,
  PanelPlan,
  SceneBible,
  StoredImage,
} from './types.ts';

/** Key người dùng nhập trong Cài đặt được ưu tiên, nếu không có thì dùng key trong Secrets. */
const client = () => {
  const apiKey = activeApiKey();
  if (!apiKey) throw new Error('Chưa có API key. Mở Cài đặt để nhập key.');
  return new GoogleGenAI({ apiKey });
};

/** Gọi thử một yêu cầu rất nhỏ để biết key và model có dùng được không. */
export async function testConnection(apiKey: string, model: string): Promise<void> {
  const key = apiKey.trim() || envApiKey();
  if (!key) throw new Error('Chưa có API key để kiểm tra.');
  await new GoogleGenAI({ apiKey: key }).models.generateContent({
    model: model.trim() || activeModel(),
    contents: { parts: [{ text: 'Reply with the single word OK.' }] },
  });
}

/** Hồ sơ cảnh dưới dạng chữ để đưa vào prompt; tham chiếu viết dạng {{tên}}. */
function bibleText(bible: SceneBible | null, characters: Character[], refs: { id: string; name: string }[]): string {
  const b = activeBible(bible);
  if (!b) return '';
  const t = (x: string) => mentionsToTokens(x.trim(), characters);
  const descs = refs
    .map((r) => [r.name, (b.descriptors[r.id] ?? '').trim()] as const)
    .filter(([, d]) => d)
    .map(([n, d]) => `- {{${n}}} = ${d}`);
  return [
    'LOCKED SCENE BIBLE (applies to every beat of this scene; follow it exactly and never reinvent it. Only exception: something the END STATE of the previous beat says has changed)',
    b.style.trim() ? `Style: ${t(b.style)}` : '',
    b.location.trim() ? `Location: ${t(b.location)}` : '',
    b.blocking.trim() ? `Screen direction / blocking: ${t(b.blocking)}` : '',
    descs.length ? `Fixed reference descriptions:\n${descs.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const referenceList = (characters: Character[]) =>
  characters.length
    ? characters.map((c) => `- ${c.name || 'Unnamed'}: ${c.appearance || '(no description)'}`).join('\n')
    : '(no reference images provided)';

// ---------------------------------------------------------------------------
// Bước 1: đề xuất panel plan
// ---------------------------------------------------------------------------
const panelSchema = {
  type: Type.OBJECT,
  properties: {
    role: { type: Type.STRING, enum: ['setup', 'action', 'peak', 'consequence'] },
    moment: { type: Type.STRING },
    shotSize: { type: Type.STRING },
    durationSec: { type: Type.NUMBER },
    speaker: { type: Type.STRING },
    dialogue: { type: Type.STRING },
    between: { type: Type.STRING },
  },
  required: ['role', 'moment', 'shotSize', 'durationSec', 'speaker', 'dialogue', 'between'],
};

const planSchema = {
  type: Type.OBJECT,
  properties: {
    actions: { type: Type.ARRAY, items: { type: Type.STRING } },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    parts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          actions: { type: Type.ARRAY, items: { type: Type.STRING } },
          script: { type: Type.STRING },
          beatSummary: { type: Type.STRING },
          editMode: { type: Type.STRING, enum: ['continuous', 'cuts'] },
          refs: { type: Type.ARRAY, items: { type: Type.STRING } },
          warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
          panels: { type: Type.ARRAY, items: panelSchema },
        },
        required: ['actions', 'script', 'beatSummary', 'editMode', 'refs', 'warnings', 'panels'],
      },
    },
  },
  required: ['actions', 'warnings', 'parts'],
};

/** Một storyboard (một video) sau khi chia kịch bản. */
export interface PlannedPart {
  /** Đoạn kịch bản mà storyboard này diễn */
  script: string;
  plan: PanelPlan;
}

/** Số storyboard tối đa cho một lần phân tích (tránh AI chia vụn). */
const MAX_PARTS = 6;

export async function planBeat(
  scriptText: string,
  characters: Character[],
  previous: BeatSequence | null,
  bible: SceneBible | null = null,
): Promise<PlannedPart[]> {
  const available = refCharacters(characters);
  const scene = bibleText(bible, characters, buildRefs(characters, available.map((c) => c.id)));
  const context = previous
    ? `This script CONTINUES the previous beat. Panel 1 of the first storyboard must start from the state where the previous beat ended.\n${describePreviousBeat(previous)}`
    : 'This script is STANDALONE. Do not assume any earlier context.';

  const prompt = `You are a storyboard planner for an AI video generator (Gemini Omni 1.1 Flash). Each generated video is at most ${MAX_TOTAL_SEC} seconds and is driven by ONE 2x2 storyboard grid of exactly 4 keyframe panels (read left-to-right, top-to-bottom).

${context}
${scene ? `\n${scene}\nPlan the panels so they fit this location and keep the screen direction.\n` : ''}
STEP 1 - MAIN ACTIONS
List the MAIN ACTIONS of the script in story order. A main action is one distinct physical event or story change that needs its own screen time: someone appears, moves somewhere, grabs or uses something, escapes, reacts strongly, or says an important line. Small connecting movements inside the same action (a glance, a step, turning around) are NOT main actions.

STEP 2 - SPLIT INTO STORYBOARDS
Professional AI video practice: about one main action per 5 seconds and never more than ${MAX_ACTIONS_PER_STORYBOARD} main actions in one 10-second video; overloaded clips come out rushed or silently drop actions.
- Each storyboard ("part") covers at most ${MAX_ACTIONS_PER_STORYBOARD} consecutive main actions. If the script has more, split it into several parts, in story order, at natural story points. Never drop a main action and never squeeze extra main actions into a part.
- If the script has only 1 or 2 main actions, return exactly 1 part.
- Part 2 onward starts exactly where the previous part ends (same positions, props, lighting).

STEP 3 - 4 PANELS PER PART
For each part, make EXACTLY 4 keyframe panels that are the beats of its 1-2 main actions: setup -> action -> peak -> consequence (before, during, the peak moment, the aftermath or a reaction). With 2 actions, give each action 2 panels. Each panel freezes ONE clear moment; it is a still keyframe, not a sequence.
- Give adjacent panels different framing so the beats have rhythm, yet keep them continuous: same characters, objects, costumes, location and lighting. If the part is one continuous shot (editMode "continuous"), every framing change must be reachable by moving the camera (push in, pull back, pan, follow) within the panel's seconds, so keep the changes moderate; big jumps such as wide shot to extreme close-up need editMode "cuts".

FIELDS
- actions (top level): every main action of the script, in VIETNAMESE, a few words each.
- warnings (top level): Vietnamese sentences, only when useful (e.g. the script is very thin). Otherwise an empty array.
- parts[].actions: the 1-${MAX_ACTIONS_PER_STORYBOARD} main actions this part covers, copied from the top-level list.
- parts[].script: the lines of the original script this part covers, copied VERBATIM (keep @names and dialogue unchanged; you may cut a sentence at a natural point).
- parts[].beatSummary: one Vietnamese sentence summarising the part.
- parts[].editMode: "continuous" if the part is one place/time and the camera can flow through it as one shot; "cuts" if it naturally jumps between separate shots.
- parts[].refs: the EXACT names (from the REFERENCES list) of every reference that appears on screen in this part. Do not include references that do not appear.
- parts[].warnings: Vietnamese sentences, only when useful. Otherwise an empty array.
- parts[].panels (exactly 4):
  - role: setup | action | peak | consequence.
  - moment: what is visible in this frozen moment, written in VIETNAMESE, one or two short sentences.
  - shotSize: short English cinematic term (e.g. "Wide shot", "Medium shot", "Close-up", "Extreme close-up", "Over-the-shoulder").
  - durationSec: seconds this panel occupies in the video. Give each main action at least 4 seconds in total. A panel with dialogue must be long enough to speak the line (about 2.5 English words per second, or about 4 Vietnamese syllables per second). The 4 panels of a part total between ${MIN_TOTAL_SEC} and ${MAX_TOTAL_SEC} seconds.
  - speaker / dialogue: the spoken line for this panel, copied VERBATIM from the script (do not translate or rewrite). Empty strings if nobody speaks.
  - between: small movements that connect this panel to the next, in VIETNAMESE. Empty string if none. Never put a main action here.

Do not invent plot beyond the script. Small connecting actions are fine.

REFERENCES (characters and objects that have reference images)
${referenceList(available)}

SCRIPT
${scriptText}`;

  const response = await client().models.generateContent({
    model: activeModel(),
    contents: { parts: [{ text: prompt }] },
    config: { responseMimeType: 'application/json', responseSchema: planSchema },
  });

  const raw = JSON.parse(response.text || '{}');
  const names = (x: unknown): string[] => (Array.isArray(x) ? x.filter((n): n is string => typeof n === 'string') : []);
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // Kết quả kiểu cũ (một plan, không có "parts") vẫn đọc được.
  const rawParts: any[] = (Array.isArray(raw?.parts) && raw.parts.length ? raw.parts : [raw]).slice(0, MAX_PARTS);
  const topWarnings = names(raw?.warnings);
  if (Array.isArray(raw?.parts) && raw.parts.length > MAX_PARTS) {
    topWarnings.push(`AI chia thành ${raw.parts.length} storyboard, đã giữ ${MAX_PARTS} phần đầu. Nên tách kịch bản ngắn lại.`);
  }

  return rawParts.map((rp, i) => {
    const partScript = str(rp?.script) || scriptText;
    // Tham chiếu của phần: tên AI liệt kê cho phần + @tên trong đoạn kịch bản của phần.
    let refIds = detectRefIds(characters, partScript, names(rp?.refs));
    if (!refIds.length) refIds = detectRefIds(characters, scriptText, names(rp?.refs));
    const plan = normalizePlan(rp, refIds);
    if (i === 0 && topWarnings.length) plan.warnings = [...topWarnings, ...plan.warnings];
    return { script: partScript, plan };
  });
}

// ---------------------------------------------------------------------------
// Bước 2: sinh nội dung chi tiết từ plan (đã được người dùng sửa)
// ---------------------------------------------------------------------------
const imagePanelSchema = {
  type: Type.OBJECT,
  properties: {
    framing: { type: Type.STRING },
    content: { type: Type.STRING },
    environment: { type: Type.STRING },
    lens: { type: Type.STRING },
    detailsVi: { type: Type.STRING },
  },
  required: ['framing', 'content', 'environment', 'lens', 'detailsVi'],
};

const videoBeatSchema = {
  type: Type.OBJECT,
  properties: {
    camera: { type: Type.STRING },
    action: { type: Type.STRING },
    sfx: { type: Type.STRING },
    noteVi: { type: Type.STRING },
  },
  required: ['camera', 'action', 'sfx', 'noteVi'],
};

const generatedSchema = {
  type: Type.OBJECT,
  properties: {
    summaryVi: { type: Type.STRING },
    sceneEn: { type: Type.STRING },
    styleBlock: { type: Type.STRING },
    refDescriptors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, en: { type: Type.STRING } },
        required: ['name', 'en'],
      },
    },
    imagePanels: { type: Type.ARRAY, items: imagePanelSchema },
    videoBeats: { type: Type.ARRAY, items: videoBeatSchema },
    audio: {
      type: Type.OBJECT,
      properties: {
        ambience: { type: Type.STRING },
        music: { type: Type.STRING },
        sfx: { type: Type.STRING },
      },
      required: ['ambience', 'music', 'sfx'],
    },
    audioNoteVi: { type: Type.STRING },
    continuityEn: { type: Type.STRING },
    videoLookEn: { type: Type.STRING },
    endState: {
      type: Type.OBJECT,
      properties: {
        positions: { type: Type.STRING },
        props: { type: Type.STRING },
        changes: { type: Type.STRING },
      },
      required: ['positions', 'props', 'changes'],
    },
  },
  required: [
    'summaryVi',
    'sceneEn',
    'styleBlock',
    'refDescriptors',
    'imagePanels',
    'videoBeats',
    'audio',
    'audioNoteVi',
    'continuityEn',
    'videoLookEn',
    'endState',
  ],
};

export async function generateBeatPrompts(
  scriptText: string,
  plan: PanelPlan,
  characters: Character[],
  aspect: AspectRatio,
  previous: BeatSequence | null,
  bible: SceneBible | null = null,
): Promise<GeneratedData> {
  const refs = buildRefs(characters, plan.refIds);
  const locked = activeBible(bible);
  const scene = bibleText(locked, characters, refs);
  const styleLocked = !!locked?.style.trim();
  const used = refCharacters(characters, plan.refIds);
  // Ảnh mốc gửi kèm sau ảnh tham chiếu: ảnh bối cảnh, ảnh lưới của beat trước.
  const extraImages: { img: StoredImage; note: string }[] = [];
  if (locked?.locationImage) {
    extraImages.push({ img: locked.locationImage, note: 'the LOCATION reference of this scene. Every environment must match it.' });
  }
  if (previous?.gridImage) {
    extraImages.push({
      img: previous.gridImage,
      note: "the 2x2 storyboard actually generated for the PREVIOUS beat. Match its art style, character designs, set and lighting; its bottom-right panel is the state panel 1 of this beat starts from.",
    });
  }
  const extraText = extraImages.length
    ? `\nADDITIONAL IMAGES (attached after the reference images)\n${extraImages
        .map((x, i) => `- image #${used.length + i + 1} = ${x.note}`)
        .join('\n')}\n`
    : '';
  const tl = timeline(plan);

  const refText = refs.length
    ? used
        .map((c, i) => `- {{${refs[i].name}}} = reference image #${i + 1}. Notes: ${c.appearance || '(none)'}`)
        .join('\n')
    : '(no references in this beat)';

  const planText = plan.panels
    .map((p, i) =>
      [
        `Panel ${i + 1} [${fmtSec(tl[i].start)}-${fmtSec(tl[i].end)}s] role=${p.role}, shot=${p.shotSize}`,
        `  moment: ${p.moment}`,
        p.between ? `  between this panel and the next: ${p.between}` : '',
        p.dialogue ? `  dialogue (${p.speaker || 'unknown speaker'}): "${p.dialogue}"` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');

  const context = previous
    ? `This beat CONTINUES the previous beat. Panel 1 must match the state where the previous beat ended (same positions, costumes, lighting, environment).\n${describePreviousBeat(previous)}`
    : 'This beat is STANDALONE.';

  const prompt = `You are a cinematic storyboard artist and prompt engineer for Gemini Omni 1.1 Flash (video) and an image generator. Write the detailed content for ONE beat that has already been planned as 4 keyframe panels in a 2x2 grid. Aspect ratio of each panel: ${aspect}.

${context}

The approved PANEL PLAN below is authoritative. Do not add, remove, reorder or change the panels, their shot sizes, or their timing.

${planText}

Beat summary: ${plan.beatSummary}
${plan.actions?.length ? `Main actions of this storyboard (the whole video shows only these): ${plan.actions.join('; ')}\n` : ''}Edit mode: ${plan.editMode === 'continuous' ? 'one continuous shot' : 'hard cuts between panels, one shot per panel'}
${scene ? `\n${scene}\n` : ''}
REFERENCES IN THIS BEAT (characters or objects; their images are attached in this order)
${refText}
${extraText}
HOW TO REFER TO REFERENCES
- Write every reference ONLY as its token, exactly as listed, e.g. {{${refs[0]?.name ?? 'name'}}}. Never write the bare name, never add tags or brackets of your own.
- Things that are NOT in the reference list are described in plain words.

LANGUAGE
Every field MUST be in ENGLISH except summaryVi, detailsVi, noteVi and audioNoteVi, which MUST be in VIETNAMESE.

OUTPUT
- sceneEn: one English sentence describing the whole beat.
- summaryVi: one Vietnamese sentence summarising the beat.
- refDescriptors: one entry per reference, name = the reference name without braces, en = a short English noun phrase (2-5 words) identifying it, based on its image, e.g. "the tan mastiff dog", "the red sausage".
${
    styleLocked
      ? '- styleBlock: return an empty string. The style is locked by the scene bible and is inserted automatically; make every other field consistent with it.'
      : '- styleBlock: ONE compact English paragraph reused in both the image and the video prompt. Cover: overall visual style (derive it from the reference images and the script), colour palette, lighting, the key visual details of each reference (use tokens), environment layout, lens language. It must lock consistency across all four panels.'
  }
- imagePanels (exactly 4, same order as the plan). These are STILL keyframes:
  - framing: the planned shot size plus camera angle and camera placement (e.g. "Medium shot, eye-level, three-quarter view"). This is a still frame: no camera movement words such as static, pan or dolly.
  - content: ONE or TWO sentences: who/what is in frame, position, pose, expression and the single frozen action. Say each thing once; do not restate the same action in other words.
  - environment: physical, concrete description of the place and background visible in this framing (materials, textures, light sources). ${locked?.location.trim() ? 'It MUST match the locked location of the scene bible; only describe the part visible from this angle. ' : ''}Avoid vague adjectives such as "beautiful" or "dramatic".
  - lens: focal length feel and depth of field.
  - detailsVi: Vietnamese description of mood, context and action of the panel.
- videoBeats (exactly 4, same order as the plan). Each describes only what happens inside that panel's time window:
  - camera: camera movement only, with speed (e.g. "static camera", "slow push-in", "handheld follow"); the shot size is added automatically, do not repeat it. ${
    plan.editMode === 'continuous'
      ? "The video is one continuous shot: reach each panel's planned framing by moving the camera from the previous panel (e.g. \"slow push-in to a close-up\"), so the movement flows from one beat into the next."
      : 'The video cuts between panels: one camera behaviour per shot.'
  }
  - action: ONE clear action for this panel's seconds, the moment shown in its keyframe. ${
    plan.editMode === 'continuous'
      ? 'Include the small "between" movements from the plan that lead into the next panel.'
      : 'Show only this panel\'s moment; movement from one panel to the next happens across the cut, so do not include it.'
  } Never pack several actions into one panel (no "first ... then ... then ..."); overloaded shots come out rushed. For a reaction shot, say what the character is looking at or reacting to (e.g. "{{${refs[0]?.name ?? 'name'}}} stares at the empty trap"). NEVER include spoken dialogue here (it is added separately).
  - sfx: the sound effect heard during this panel, a few English words (e.g. "a soft squeak", "a cartoon whoosh"), or "none".
  - noteVi: a short Vietnamese explanation of this beat.
- audio: ambience and music that run through the whole beat, and a short summary of its sound effects (use "none" when silence is intended). Lower-case phrases; do not end these fields with punctuation. audioNoteVi: short Vietnamese explanation.
- videoLookEn: ONE short English sentence (at most 20 words) for the video prompt: rendering style, lighting and place, e.g. "Stylised 3D animated film, warm afternoon light in a small kitchen".${
    locked ? ' It must be a faithful summary of the locked scene bible.' : ''
  } The storyboard image carries the details, so keep it short.
- continuityEn: ${
    previous
      ? 'ONE English sentence describing how things look at the START of this beat because of the previous END STATE: changes from the reference images that are already visible when panel 1 begins (e.g. "{{cho}} no longer wears its collar; a broken plate lies on the floor"). NEVER mention anything that happens during this beat. Use tokens for references. Empty string if nothing carries over.'
      : 'return an empty string (this beat does not continue another beat).'
  }
- endState (VIETNAMESE, short and concrete): the exact state at the END of panel 4, so the next beat can continue from it.
  - positions: where each character/reference is (in the frame and in the location), pose, facing direction.
  - props: where each important object is and who holds it.
  - changes: every change that must persist from now on: changes carried over from the previous END STATE plus those made in this beat (costume, damage, objects moved, lighting). Empty string if nothing.

RULES
- No text, captions, signs with invented writing, numbers or logos in any panel.
- Never use quotation marks in any English field (the video model renders quoted words as on-screen text).
- The four panels must look like the same scene: same characters, objects, costumes, location and lighting; only pose, position and framing change.${
    locked?.blocking.trim() ? '\n- Respect the locked screen direction: do not swap which side of the frame each character is on.' : ''
  }

ORIGINAL SCRIPT
${scriptText}`;

  const parts: any[] = [{ text: prompt }];
  // Gửi ảnh đầu tiên của mỗi tham chiếu trong beat, đúng thứ tự đã liệt kê.
  used.forEach((c) => {
    const img = c.images[0];
    parts.push({ inlineData: { data: img.base64.split(',')[1], mimeType: img.mimeType } });
  });
  extraImages.forEach(({ img }) => parts.push(inlinePart(img)));

  const response = await client().models.generateContent({
    model: activeModel(),
    contents: { parts },
    config: { responseMimeType: 'application/json', responseSchema: generatedSchema },
  });

  const data = applyBible(normalizeGenerated(JSON.parse(response.text || '{}'), refs), locked, characters, refs);
  return {
    ...data,
    continuityEn: previous ? data.continuityEn : '',
    anchors: { location: !!locked?.locationImage, prevGrid: !!previous?.gridImage },
  };
}

const inlinePart = (img: StoredImage) => ({
  inlineData: { data: img.base64.split(',')[1], mimeType: img.mimeType },
});

// ---------------------------------------------------------------------------
// Hồ sơ cảnh: AI viết bản nháp từ ảnh tham chiếu và kịch bản, người dùng sửa rồi khoá
// ---------------------------------------------------------------------------
const bibleSchema = {
  type: Type.OBJECT,
  properties: {
    style: { type: Type.STRING },
    location: { type: Type.STRING },
    blocking: { type: Type.STRING },
    refDescriptors: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, en: { type: Type.STRING } },
        required: ['name', 'en'],
      },
    },
  },
  required: ['style', 'location', 'blocking', 'refDescriptors'],
};

export async function draftSceneBible(
  characters: Character[],
  scriptText: string,
  locationImage: StoredImage | null = null,
): Promise<Omit<SceneBible, 'enabled' | 'locationImage'>> {
  const used = refCharacters(characters);
  const refs = buildRefs(characters, used.map((c) => c.id));
  const refText = refs.length
    ? used.map((c, i) => `- @${refs[i].name} = reference image #${i + 1}. Notes: ${c.appearance || '(none)'}`).join('\n')
    : '(no references)';

  const prompt = `You are the production designer of an animated film. Write a SCENE BIBLE that will be locked and reused, word for word, in the image and video prompts of EVERY beat of this scene, so that all storyboards of the scene look like the same film, the same place and the same characters.

Write everything in ENGLISH. Refer to references ONLY as @name exactly as listed (e.g. @${refs[0]?.name ?? 'name'}). Be concrete and visual; avoid vague words such as "beautiful", "cinematic" or "dramatic".

- style: ONE compact paragraph: rendering style (derive it from the reference images), colour palette, lighting and time of day, lens language. 2-4 sentences.
- location: the physical place as a fixed layout a camera can move around in: what is on the left, right, back and front, key furniture and objects with materials and colours, light sources and where they are. 2-4 sentences. If the script does not state the place, infer the most plausible one.
- blocking: screen direction for the scene: where each character usually is in frame (left/right), which way they face, and the side of the 180-degree line the camera stays on. 1-2 sentences.
- refDescriptors: one entry per reference, name = the reference name without @, en = a short English noun phrase (3-8 words) that identifies it from its image, including signature colours or costume, e.g. "the tan mastiff dog with a red collar".

REFERENCES (images attached in this order)
${refText}
${locationImage ? `- image #${used.length + 1} = a photo/illustration of the LOCATION. Describe the location from this image.\n` : ''}
SCRIPT (may contain only the first beat of the scene)
${scriptText || '(empty)'}`;

  const parts: any[] = [{ text: prompt }];
  used.forEach((c) => {
    const img = c.images[0];
    parts.push({ inlineData: { data: img.base64.split(',')[1], mimeType: img.mimeType } });
  });
  if (locationImage) parts.push(inlinePart(locationImage));

  const response = await client().models.generateContent({
    model: activeModel(),
    contents: { parts },
    config: { responseMimeType: 'application/json', responseSchema: bibleSchema },
  });

  const raw = JSON.parse(response.text || '{}');
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const descriptors: Record<string, string> = {};
  (Array.isArray(raw?.refDescriptors) ? raw.refDescriptors : []).forEach((d: any) => {
    const r = refs.find((x) => x.name.toLowerCase() === str(d?.name).replace(/^@/, '').toLowerCase());
    if (r && str(d?.en)) descriptors[r.id] = str(d.en);
  });
  return { style: str(raw?.style), location: str(raw?.location), blocking: str(raw?.blocking), descriptors };
}
