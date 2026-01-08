/**
 * Simulates an AI service that processes raw transcription and pitch data
 * to perform speaker diarization.
 */
export class AIService {
    static async analyzeVoiceData(data) {
        console.log("AI Service: Received raw data for analysis", data);
        
        // Artificial delay to simulate "AI processing"
        await new Promise(resolve => setTimeout(resolve, 1500));

        const { transcript, pitchHistory } = data;
        
        if (transcript.length === 0) return [];

        // Simple Diarization Logic based on Pitch Thresholds:
        // We cluster segments into 'Speaker 1' or 'Speaker 2' based on average frequency.
        // Usually, male voices are ~85-180Hz and female ~165-255Hz.
        // For simplicity, we'll just look at the distribution of captured pitches.

        // Assign pitch to each transcript segment by finding the closest match in history
        const processedSegments = transcript.map(segment => {
            const words = segment.text.split(' ').map(word => {
                // Attach approximate frequency info to word
                return {
                    text: word,
                    pitch: segment.pitch || 0
                };
            });

            return {
                ...segment,
                words,
                avgPitch: segment.pitch
            };
        });

        // Determine if there are multiple speakers based on pitch variance
        const validPitches = processedSegments.map(s => s.avgPitch).filter(p => p > 50);
        
        let diarizedResult = [];
        
        if (validPitches.length > 0) {
            const avg = validPitches.reduce((a, b) => a + b, 0) / validPitches.length;
            
            // Heuristic: if a segment is more than 15% away from average, 
            // and we have enough samples, potentially a different speaker.
            // In a real AI, this would be a clustering algorithm on embeddings.
            
            processedSegments.forEach((segment, index) => {
                let speakerId = 1;
                
                // If pitch exists and differs significantly from the average of the first speaker,
                // or switches significantly from the previous segment.
                if (index > 0) {
                    const prevSegment = processedSegments[index - 1];
                    const pitchDiff = Math.abs(segment.avgPitch - prevSegment.avgPitch);
                    
                    // If difference is > 40Hz, likely a different person/intonation
                    if (pitchDiff > 40 && segment.avgPitch > 50 && prevSegment.avgPitch > 50) {
                        speakerId = (prevSegment.speakerId === 1) ? 2 : 1;
                    } else {
                        speakerId = prevSegment.speakerId || 1;
                    }
                }
                
                segment.speakerId = speakerId;
                diarizedResult.push(segment);
            });
        } else {
            // Default to speaker 1 if no pitch data
            diarizedResult = processedSegments.map(s => ({ ...s, speakerId: 1 }));
        }

        // Merge consecutive segments from the same speaker
        const merged = [];
        diarizedResult.forEach(current => {
            const last = merged[merged.length - 1];
            if (last && last.speakerId === current.speakerId) {
                last.words.push(...current.words);
                last.avgPitch = (last.avgPitch + current.avgPitch) / 2;
            } else {
                merged.push({ ...current });
            }
        });

        return merged;
    }
}