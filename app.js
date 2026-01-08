import { createIcons, Mic, Square, User, Users } from 'lucide';
import { PitchAnalyzer } from './audio-processor.js';
import { AIService } from './ai-service.js';

class App {
    constructor() {
        this.recording = false;
        this.audioContext = null;
        this.pitchAnalyzer = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.speechRecognition = null;
        this.recordedData = {
            transcript: [],
            pitchHistory: [],
            startTime: 0
        };

        this.initUI();
        this.initSpeechRecognition();
        this.initAudioAssets();
    }

    initUI() {
        createIcons({
            icons: { Mic, Square, User, Users }
        });

        this.recordBtn = document.getElementById('record-btn');
        this.micIcon = document.getElementById('mic-icon');
        this.statusText = document.getElementById('status-text');
        this.transcriptContainer = document.getElementById('transcript-content');
        this.analysisBadge = document.getElementById('analysis-badge');
        this.visualizer = document.getElementById('visualizer');
        this.pitchDisplay = document.getElementById('pitch-display');

        this.recordBtn.addEventListener('click', () => this.toggleRecording());
    }

    initAudioAssets() {
        this.sounds = {
            start: new Audio('record_start.mp3'),
            stop: new Audio('record_stop.mp3'),
            done: new Audio('processing_done.mp3')
        };
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.statusText.innerText = "Speech Recognition not supported in this browser.";
            return;
        }

        this.speechRecognition = new SpeechRecognition();
        this.speechRecognition.continuous = true;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.lang = 'en-US';

        this.speechRecognition.onresult = (event) => {
            let interimTranscript = '';
            
            // Handle multiple results in the buffer
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    const text = event.results[i][0].transcript.trim();
                    if (text) {
                        this.processFinalSegment(text);
                    }
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            // Update UI with interim text
            this.updateLivePreview(interimTranscript);
        };

        this.speechRecognition.onerror = (event) => {
            console.error('Speech Recognition Error:', event.error);
            // Ignore no-speech error as it happens frequently in silence
            if (event.error !== 'no-speech') {
                this.statusText.innerText = `Error: ${event.error}`;
            }
        };
        
        // Ensure it restarts if it stops unexpectedly while recording
        this.speechRecognition.onend = () => {
            if (this.recording) {
                try {
                    this.speechRecognition.start();
                } catch (e) {
                    console.log("Recognition restart suppressed");
                }
            }
        };
    }

    processFinalSegment(text) {
        const now = Date.now();
        // Determine time window for this segment
        // Start time is either the beginning of recording or end of last segment
        const startTime = this.lastSegmentEndTime || this.recordedData.startTime;
        this.lastSegmentEndTime = now;

        // Filter pitch history for this time window
        const segmentPitches = this.recordedData.pitchHistory.filter(
            p => p.time >= startTime && p.time <= now
        );

        // Calculate statistics
        let avgPitch = 0;
        let minPitch = 0;
        let maxPitch = 0;

        if (segmentPitches.length > 0) {
            const sum = segmentPitches.reduce((a, b) => a + b.pitch, 0);
            avgPitch = sum / segmentPitches.length;
            minPitch = Math.min(...segmentPitches.map(p => p.pitch));
            maxPitch = Math.max(...segmentPitches.map(p => p.pitch));
        }

        const segmentData = {
            text,
            startTime: startTime - this.recordedData.startTime,
            endTime: now - this.recordedData.startTime,
            pitch: avgPitch,
            pitchRange: [minPitch, maxPitch],
            sampleCount: segmentPitches.length
        };

        this.recordedData.transcript.push(segmentData);
        this.addCommittedSegmentToUI(segmentData);
        
        // Clear live preview explicitly
        this.updateLivePreview('');
    }

    updateLivePreview(text) {
        let previewEl = document.getElementById('live-preview-text');
        if (!previewEl) {
            // Create if doesn't exist (it might be cleared)
            previewEl = document.createElement('div');
            previewEl.id = 'live-preview-text';
            previewEl.className = 'live-preview';
            this.transcriptContainer.appendChild(previewEl);
        }
        
        if (!text) {
            previewEl.remove();
        } else {
            previewEl.innerText = text + '...';
            this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
        }
    }

    addCommittedSegmentToUI(segment) {
        const p = document.createElement('div');
        p.className = 'speaker-block';
        p.style.opacity = '0.7'; // Dim slightly until analyzed
        p.innerHTML = `
            <div class="speaker-label speaker-unknown">
                Captured Segment 
                <span style="font-weight: normal; opacity: 0.7; margin-left: auto;">
                    ${Math.round(segment.pitch)} Hz
                </span>
            </div>
            <div>${segment.text}</div>
        `;
        
        // Insert before the live preview if it exists
        const previewEl = document.getElementById('live-preview-text');
        if (previewEl) {
            this.transcriptContainer.insertBefore(p, previewEl);
        } else {
            this.transcriptContainer.appendChild(p);
        }
        this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
    }

    async toggleRecording() {
        if (this.recording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.pitchAnalyzer = new PitchAnalyzer(this.audioContext, stream, this.visualizer, (pitch) => {
                this.pitchDisplay.innerText = `${Math.round(pitch)} Hz`;
                // PitchAnalyzer callback is for UI updates mainly now
            });

            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.recordedData = {
                transcript: [],
                pitchHistory: [],
                startTime: Date.now()
            };
            this.lastSegmentEndTime = this.recordedData.startTime;

            // Start high-frequency pitch tracking loop
            this.pitchInterval = setInterval(() => {
                if (this.recording && this.pitchAnalyzer) {
                    const pitch = this.pitchAnalyzer.getCurrentPitch();
                    // Only record valid vocal pitches (> 50Hz) to avoid noise
                    if (pitch > 50) {
                        this.recordedData.pitchHistory.push({
                            time: Date.now(),
                            pitch: pitch
                        });
                    }
                }
            }, 50); // Sample every 50ms

            this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
            
            this.sounds.start.play();
            this.mediaRecorder.start();
            try {
                this.speechRecognition.start();
            } catch(e) { console.warn("Recog already started"); }
            
            this.recording = true;
            this.recordBtn.classList.add('recording');
            this.micIcon.setAttribute('data-lucide', 'square');
            createIcons({ icons: { Square } });
            this.statusText.innerText = "Recording... Speak clearly.";
            this.analysisBadge.classList.add('hidden');
            this.transcriptContainer.innerHTML = ''; // Clear previous

        } catch (err) {
            console.error('Error starting recording:', err);
            this.statusText.innerText = "Microphone access denied.";
        }
    }

    async stopRecording() {
        if (!this.recording) return;

        clearInterval(this.pitchInterval);
        this.sounds.stop.play();
        this.mediaRecorder.stop();
        this.speechRecognition.stop();
        this.pitchAnalyzer.stop();
        
        this.recording = false;
        this.recordBtn.classList.remove('recording');
        this.micIcon.setAttribute('data-lucide', 'mic');
        createIcons({ icons: { Mic } });
        this.statusText.innerText = "Sending data to AI...";

        this.mediaRecorder.onstop = async () => {
            // const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
            // Send data to AI
            const results = await AIService.analyzeVoiceData(this.recordedData);
            this.sounds.done.play();
            this.displayFinalResults(results);
            this.statusText.innerText = "Analysis Complete";
            this.analysisBadge.classList.remove('hidden');
        };
    }

    displayFinalResults(diarization) {
        this.transcriptContainer.innerHTML = '';
        
        diarization.forEach(segment => {
            const block = document.createElement('div');
            block.className = 'speaker-block';
            
            const speakerClass = segment.speakerId === 1 ? 'speaker-1' : (segment.speakerId === 2 ? 'speaker-2' : 'speaker-unknown');
            const icon = segment.speakerId === 1 ? 'user' : 'users';

            block.innerHTML = `
                <div class="speaker-label ${speakerClass}">
                    <i data-lucide="${icon}" style="width:14px;height:14px;"></i>
                    Speaker ${segment.speakerId} 
                    <span style="font-weight: normal; opacity: 0.7; margin-left: auto;">${(segment.avgPitch).toFixed(1)} Hz avg</span>
                </div>
                <div class="speaker-text">
                    ${segment.words.map(w => `
                        <span class="word-tag">
                            ${w.text}
                            <span class="word-info">${Math.round(w.pitch)}Hz</span>
                        </span>
                    `).join(' ')}
                </div>
            `;
            this.transcriptContainer.appendChild(block);
        });
        
        createIcons({ icons: { User, Users } });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new App();
});