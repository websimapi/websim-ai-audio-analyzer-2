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

        this.speechRecognition.onresult = (event) => {
            const results = event.results;
            const lastResult = results[results.length - 1];
            
            if (lastResult.isFinal) {
                const timestamp = Date.now() - this.recordedData.startTime;
                const text = lastResult[0].transcript.trim();
                
                // Estimate pitch at this time
                const currentPitch = this.pitchAnalyzer ? this.pitchAnalyzer.getCurrentPitch() : 0;

                this.recordedData.transcript.push({
                    text,
                    time: timestamp,
                    pitch: currentPitch
                });

                this.updateLiveTranscript();
            }
        };

        this.speechRecognition.onerror = (event) => {
            console.error('Speech Recognition Error:', event.error);
        };
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
                if (this.recording) {
                    this.recordedData.pitchHistory.push({
                        t: Date.now() - this.recordedData.startTime,
                        f: pitch
                    });
                }
            });

            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];
            this.recordedData = {
                transcript: [],
                pitchHistory: [],
                startTime: Date.now()
            };

            this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
            
            this.sounds.start.play();
            this.mediaRecorder.start();
            this.speechRecognition.start();
            
            this.recording = true;
            this.recordBtn.classList.add('recording');
            this.micIcon.setAttribute('data-lucide', 'square');
            createIcons({ icons: { Square } });
            this.statusText.innerText = "Recording... Speak now.";
            this.analysisBadge.classList.add('hidden');
            this.transcriptContainer.innerHTML = '<p style="text-align: center; color: var(--accent);">Listening...</p>';

        } catch (err) {
            console.error('Error starting recording:', err);
            this.statusText.innerText = "Microphone access denied.";
        }
    }

    async stopRecording() {
        if (!this.recording) return;

        this.sounds.stop.play();
        this.mediaRecorder.stop();
        this.speechRecognition.stop();
        this.pitchAnalyzer.stop();
        
        this.recording = false;
        this.recordBtn.classList.remove('recording');
        this.micIcon.setAttribute('data-lucide', 'mic');
        createIcons({ icons: { Mic } });
        this.statusText.innerText = "Processing with AI...";

        this.mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
            
            // Send data to "AI"
            const results = await AIService.analyzeVoiceData(this.recordedData);
            this.sounds.done.play();
            this.displayFinalResults(results);
            this.statusText.innerText = "Analysis Complete";
            this.analysisBadge.classList.remove('hidden');
        };
    }

    updateLiveTranscript() {
        if (this.recordedData.transcript.length === 0) return;
        
        const lastItem = this.recordedData.transcript[this.recordedData.transcript.length - 1];
        const p = document.createElement('div');
        p.className = 'speaker-block';
        p.innerHTML = `<span class="speaker-unknown">Captured:</span> ${lastItem.text}`;
        
        if (this.transcriptContainer.firstChild?.tagName === 'P') {
            this.transcriptContainer.innerHTML = '';
        }
        this.transcriptContainer.appendChild(p);
        this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
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