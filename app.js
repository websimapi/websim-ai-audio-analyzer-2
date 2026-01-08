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
        this.currentInterimText = '';
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
        this.liveTranscript = document.getElementById('live-transcript');
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
        // Set continuous to false to prevent buffer duplication bugs (Manual Continuous Loop strategy)
        this.speechRecognition.continuous = false;
        this.speechRecognition.interimResults = true;
        this.speechRecognition.lang = 'en-US';

        this.speechRecognition.onresult = (event) => {
            let interimTranscript = '';

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

            this.currentInterimText = interimTranscript;
            this.updateLivePreview(interimTranscript);
        };

        this.speechRecognition.onerror = (event) => {
            // Filter out errors that are normal during manual restarting
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            
            console.error('Speech Recognition Error:', event.error);
            this.statusText.innerText = `Error: ${event.error}`;
        };
        
        // Robust restart loop
        this.speechRecognition.onend = () => {
            if (this.recording) {
                try {
                    this.speechRecognition.start();
                } catch (e) {
                    // Ignore start errors (e.g. if already started)
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
        
        // Reset live preview to listening state
        this.updateLivePreview('');
    }

    updateLivePreview(text) {
        if (!this.liveTranscript) return;
        
        if (text) {
            this.liveTranscript.innerText = text;
            this.liveTranscript.style.fontStyle = 'normal';
        } else if (this.recording) {
            this.liveTranscript.innerText = "Listening... (Speak clearly)";
            this.liveTranscript.style.fontStyle = 'italic';
        } else {
            this.liveTranscript.innerText = "Ready to transcribe...";
            this.liveTranscript.style.fontStyle = 'italic';
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
        
        this.transcriptContainer.appendChild(p);
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
            });

            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.currentInterimText = '';
            this.recordedData = {
                transcript: [],
                pitchHistory: [],
                startTime: Date.now()
            };
            this.lastSegmentEndTime = this.recordedData.startTime;

            // Define handlers immediately to prevent race conditions where stop() is called before onstop is defined
            this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
            this.mediaRecorder.onstop = () => {
                console.log("MediaRecorder stopped.");
                // Analysis is now triggered explicitly in stopRecording to ensure synchronization with SpeechRecognition
            };

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
            }, 50);

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
            this.liveTranscript.classList.add('active');
            this.liveTranscript.innerText = "Listening...";
            
            this.analysisBadge.classList.add('hidden');
            this.transcriptContainer.innerHTML = ''; // Clear previous

        } catch (err) {
            console.error('Error starting recording:', err);
            this.statusText.innerText = "Microphone access denied.";
        }
    }

    async stopRecording() {
        if (!this.recording) return;

        // Update flag first so onend doesn't restart
        this.recording = false;

        clearInterval(this.pitchInterval);
        this.sounds.stop.play();
        
        this.statusText.innerText = "Finalizing capture...";
        
        // Stop recorders
        if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop();
        this.speechRecognition.stop();
        this.pitchAnalyzer.stop();
        
        // Wait briefly for any final speech events to trickle in from the engine
        await new Promise(resolve => setTimeout(resolve, 800));

        // Flush any remaining interim text that wasn't finalized by the engine
        if (this.currentInterimText && this.currentInterimText.trim().length > 0) {
            console.log("Flushing remaining interim text:", this.currentInterimText);
            this.processFinalSegment(this.currentInterimText);
            this.currentInterimText = '';
        }

        this.finalizeSession();
    }

    async finalizeSession() {
        this.recordBtn.classList.remove('recording');
        this.micIcon.setAttribute('data-lucide', 'mic');
        createIcons({ icons: { Mic } });
        
        this.statusText.innerText = "Analyzing data...";
        this.liveTranscript.classList.remove('active');
        this.liveTranscript.innerText = "Processing...";

        // Check if we actually captured any text
        if (this.recordedData.transcript.length === 0) {
            this.statusText.innerText = "No speech text detected.";
            this.liveTranscript.innerText = "No speech captured. Try speaking louder or closer.";
            this.analysisBadge.classList.add('hidden');
            return;
        }

        try {
            const results = await AIService.analyzeVoiceData(this.recordedData);
            this.sounds.done.play();
            this.displayFinalResults(results);
            this.statusText.innerText = "Analysis Complete";
            this.analysisBadge.classList.remove('hidden');
        } catch (err) {
            console.error("Analysis error:", err);
            this.statusText.innerText = "Analysis Failed";
            this.liveTranscript.innerText = "Error analyzing data.";
        }
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