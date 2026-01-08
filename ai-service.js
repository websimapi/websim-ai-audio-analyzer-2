/**
 * Simulates an AI service that processes raw transcription and pitch data
 * to perform speaker diarization.
 */
export class AIService {
    static async analyzeVoiceData(data) {
        console.log("AI Service: Received raw data for analysis", data);
        const { transcript } = data;

        if (transcript.length === 0) return [];

        // Prepare data for the LLM
        // We summarize the collected data to keep tokens low but info high
        const segmentsSummary = transcript.map((s, i) => {
            const avg = isNaN(s.pitch) ? 0 : Math.round(s.pitch);
            const min = isNaN(s.pitchRange[0]) ? 0 : Math.round(s.pitchRange[0]);
            const max = isNaN(s.pitchRange[1]) ? 0 : Math.round(s.pitchRange[1]);
            return `Segment ${i + 1}:
  Text: "${s.text}"
  Avg Pitch: ${avg} Hz
  Pitch Range: ${min}-${max} Hz`;
        }).join('\n\n');

        const systemPrompt = `You are a sophisticated Audio Analysis AI.
Your goal is to perform "Speaker Diarization" (identifying who spoke what) based on transcription and pitch data provided.

Context:
- Pitch usually helps distinguish speakers (e.g., lower vs higher voices).
- Significant changes in Average Pitch often indicate a new speaker.
- Typical Male fundamental frequency: 85-180 Hz.
- Typical Female fundamental frequency: 165-255 Hz.
- Use context clues in the text (questions/answers) combined with pitch shifts to assign Speaker IDs.

Instructions:
1. Analyze the provided Segments.
2. Assign a "speakerId" (1, 2, 3...) to each segment.
3. If pitch is very similar between segments, it's likely the same speaker.
4. If pitch jumps significantly (e.g. > 40Hz difference), it's likely a new speaker.
5. Return the result as a JSON object containing a "segments" array.
6. Each segment in the output MUST match the text of the input, but include "speakerId" and "reasoning".

Output Schema:
{
  "segments": [
    {
      "text": string,
      "speakerId": number,
      "avgPitch": number,
      "reasoning": string
    }
  ]
}`;

        try {
            const completion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Here is the raw data captured from the recording session:\n\n${segmentsSummary}\n\nPerform diarization and return JSON.` }
                ],
                json: true
            });

            // Clean potential markdown fences from the response before parsing
            let content = completion.content.replace(/```json\n?|\n?```/g, '').trim();
            const response = JSON.parse(content);
            
            // Post-processing to match the format expected by the UI (words array)
            // Use fallback empty array if segments is missing
            return this.formatForUI(response.segments || []);

        } catch (error) {
            console.error("AI Analysis failed:", error);
            // Fallback to local heuristic if LLM fails
            return this.heuristicFallback(transcript);
        }
    }

    static formatForUI(segments) {
        // Convert simple segment objects back to the word-level structure the UI expects
        return segments.map(seg => ({
            speakerId: seg.speakerId,
            avgPitch: seg.avgPitch,
            text: seg.text,
            words: seg.text.split(' ').map(w => ({
                text: w,
                pitch: seg.avgPitch // Distribute avg pitch to words as we don't have per-word alignment from LLM
            })),
            reasoning: seg.reasoning
        }));
    }

    static heuristicFallback(transcript) {
        // Simple threshold-based logic if AI fails
        const processed = transcript.map(t => ({
            ...t,
            speakerId: t.pitch > 165 ? 2 : 1, // Crude gender/pitch split
            words: t.text.split(' ').map(w => ({ text: w, pitch: t.pitch }))
        }));

        // Merge consecutive
        const merged = [];
        processed.forEach(current => {
            const last = merged[merged.length - 1];
            if (last && last.speakerId === current.speakerId) {
                last.words.push(...current.words);
            } else {
                merged.push({ ...current });
            }
        });
        return merged;
    }
}