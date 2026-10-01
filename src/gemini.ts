import { GoogleGenAI, Type } from '@google/genai';
import {
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
    'LOCKED SCENE BIBLE (applies to every beat of this scene; follow it exactly, never contradict or reinvent it)',
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
const planSchema = {
  type: Type.OBJECT,
  properties: {
    beatSummary: { type: Type.STRING },
    editMode: { type: Type.STRING, enum: ['continuous', 'cuts'] },
    refs: { type: Type.ARRAY, items: { type: Type.STRING } },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
    panels: {
      type: Type.ARRAY,
      items: {
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
      },
    },
  },
  required: ['beatSummary', 'editMode', 'refs', 'warnings', 'panels'],
};

export async function planBeat(
  scriptText: string,
  characters: Character[],
  previous: BeatSequence | null,
  bible: SceneBible | null = null,
): Promise<PanelPlan> {
  const available = refCharacters(characters);
  const scene = bibleText(bible, characters, buildRefs(characters, available.map((c) => c.id)));
  const context = previous
    ? `This beat CONTINUES the previous beat. Panel 1 must start from the state where the previous beat ended.\n${describePreviousBeat(previous)}`
    : 'This beat is STANDALONE. Do not assume any earlier context.';

  const prompt = `You are a storyboard planner for an AI video generator (Gemini Omni 1.1 Flash). Each video is at most ${MAX_TOTAL_SEC} seconds.
The script below is ONE beat. Turn it into EXACTLY 4 keyframe panels for a 2x2 storyboard grid (read left-to-right, top-to-bottom).

${context}
${scene ? `\n${scene}\nPlan the panels so they fit this location and keep the screen direction.\n` : ''}
METHOD
1. List what CHANGES in the beat: a new action, a discovery, an emotion shift, an important line of dialogue.
2. Pick exactly 4 keyframes.
   - If there are more than 4 changes: keep the 4 most important (opening, turning point, peak, ending). Put the smaller actions in the "between" field of the panel they happen after. Never drop story content silently.
   - If there are fewer than 4: use the pattern setup -> action -> peak -> consequence (before the action, during, the peak moment, the aftermath/reaction/pause), each with a different framing.
3. Each panel freezes ONE main action at its clearest moment. It is a still keyframe, not a sequence.
4. Adjacent panels must use different shot sizes so the four beats have rhythm, yet remain continuous: same characters, objects, costumes, location and lighting.

FIELDS
- role: setup | action | peak | consequence.
- moment: what is visible in this frozen moment, written in VIETNAMESE, one or two short sentences.
- shotSize: short English cinematic term (e.g. "Wide shot", "Medium shot", "Close-up", "Extreme close-up", "Over-the-shoulder").
- durationSec: seconds this panel occupies in the video. Simple action ~2s. Complex action or emotion that needs to land: 3-4s. A panel with dialogue must be long enough to speak the line (about 2.5 English words per second, or about 4 Vietnamese syllables per second). Total of all four MUST be between ${MIN_TOTAL_SEC} and ${MAX_TOTAL_SEC} seconds.
- speaker / dialogue: the spoken line for this panel, copied VERBATIM from the script (do not translate or rewrite). Empty strings if nobody speaks.
- between: minor actions that happen between this panel and the next, in VIETNAMESE. Empty string if none.
- beatSummary: one Vietnamese sentence summarising the beat.
- editMode: "continuous" if the beat is one place/time and the camera can flow through it as one shot; "cuts" if the beat naturally jumps between separate shots or locations.
- refs: the EXACT names (from the REFERENCES list) of every reference that appears on screen in this beat. References can be characters or objects. Do not include references that do not appear.
- warnings: Vietnamese sentences, only when useful. If the content clearly needs more than ${MAX_TOTAL_SEC}s, still return 4 panels totalling ${MAX_TOTAL_SEC}s and warn that the beat should be split. If the content is very thin (under ${MIN_TOTAL_SEC}s), warn and suggest what to add. Otherwise return an empty array.

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
  const aiNames: string[] = Array.isArray(raw?.refs) ? raw.refs.filter((x: unknown) => typeof x === 'string') : [];
  return normalizePlan(raw, detectRefIds(characters, scriptText, aiNames));
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
    noteVi: { type: Type.STRING },
  },
  required: ['camera', 'action', 'noteVi'],
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
Edit mode: ${plan.editMode === 'continuous' ? 'one continuous shot' : 'hard cuts between beats'}
${scene ? `\n${scene}\n` : ''}
REFERENCES IN THIS BEAT (characters or objects; their images are attached in this order)
${refText}

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
  - framing: the planned shot size plus camera angle and camera placement (e.g. "Medium shot, eye-level, three-quarter view").
  - content: ONE or TWO sentences: who/what is in frame, position, pose, expression and the single frozen action. Say each thing once; do not restate the same action in other words.
  - environment: physical, concrete description of the place and background visible in this framing (materials, textures, light sources). ${locked?.location.trim() ? 'It MUST match the locked location of the scene bible; only describe the part visible from this angle. ' : ''}Avoid vague adjectives such as "beautiful" or "dramatic".
  - lens: focal length feel and depth of field.
  - detailsVi: Vietnamese description of mood, context and action of the panel.
- videoBeats (exactly 4, same order as the plan). Each describes only what happens inside that panel's time window:
  - camera: camera movement with speed (e.g. "Slow dolly-in", "Static", "Handheld follow"). When edit mode is one continuous shot, make the camera movement flow from one beat into the next.
  - action: what moves and happens in order (use "first ... then ..." when there are several actions), including the "between" actions from the plan. Keep it realistic for the number of seconds available. NEVER include spoken dialogue here (it is added separately).
  - noteVi: a short Vietnamese explanation of this beat.
- audio: concrete ambience, music and sound effects that fit the beat (use "none" when silence is intended). Do not end these fields with punctuation. audioNoteVi: short Vietnamese explanation.
- endState (VIETNAMESE, short and concrete): the exact state at the END of panel 4, so the next beat can continue from it.
  - positions: where each character/reference is (in the frame and in the location), pose, facing direction.
  - props: where each important object is and who holds it.
  - changes: what changed during this beat and must persist (costume, damage, objects moved, lighting). Empty string if nothing.

RULES
- No text, captions, signs with invented writing, numbers or logos in any panel.
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

  const response = await client().models.generateContent({
    model: activeModel(),
    contents: { parts },
    config: { responseMimeType: 'application/json', responseSchema: generatedSchema },
  });

  const data = normalizeGenerated(JSON.parse(response.text || '{}'), refs);
  return applyBible(data, locked, characters, refs);
}

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
): Promise<Omit<SceneBible, 'enabled'>> {
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

SCRIPT (may contain only the first beat of the scene)
${scriptText || '(empty)'}`;

  const parts: any[] = [{ text: prompt }];
  used.forEach((c) => {
    const img = c.images[0];
    parts.push({ inlineData: { data: img.base64.split(',')[1], mimeType: img.mimeType } });
  });

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
