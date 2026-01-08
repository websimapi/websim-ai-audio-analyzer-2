export class PitchAnalyzer {
    constructor(audioContext, stream, canvas, onPitchUpdate) {
        this.audioContext = audioContext;
        this.stream = stream;
        this.canvas = canvas;
        this.canvasCtx = canvas.getContext('2d');
        this.onPitchUpdate = onPitchUpdate;
        
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.source = this.audioContext.createMediaStreamSource(stream);
        this.source.connect(this.analyser);
        
        this.dataArray = new Float32Array(this.analyser.fftSize);
        this.currentPitch = 0;
        this.running = true;
        
        this.draw();
    }

    getCurrentPitch() {
        return this.currentPitch;
    }

    stop() {
        this.running = false;
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
    }

    draw() {
        if (!this.running) return;
        requestAnimationFrame(() => this.draw());

        this.analyser.getFloatTimeDomainData(this.dataArray);
        
        // Pitch detection using Auto-correlation
        this.currentPitch = this.autoCorrelate(this.dataArray, this.audioContext.sampleRate);
        if (this.currentPitch !== -1) {
            this.onPitchUpdate(this.currentPitch);
        }

        // Visualize
        const width = this.canvas.width = this.canvas.clientWidth;
        const height = this.canvas.height = this.canvas.clientHeight;
        
        this.canvasCtx.fillStyle = '#1e293b';
        this.canvasCtx.fillRect(0, 0, width, height);
        
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.strokeStyle = '#6366f1';
        this.canvasCtx.beginPath();
        
        const sliceWidth = width / this.dataArray.length;
        let x = 0;
        
        for (let i = 0; i < this.dataArray.length; i++) {
            const v = this.dataArray[i] * 100;
            const y = height / 2 + v;
            
            if (i === 0) {
                this.canvasCtx.moveTo(x, y);
            } else {
                this.canvasCtx.lineTo(x, y);
            }
            x += sliceWidth;
        }
        
        this.canvasCtx.lineTo(width, height / 2);
        this.canvasCtx.stroke();
    }

    // Basic Autocorrelation algorithm for pitch detection
    autoCorrelate(buffer, sampleRate) {
        let SIZE = buffer.length;
        let rms = 0;

        for (let i = 0; i < SIZE; i++) {
            const val = buffer[i];
            rms += val * val;
        }
        rms = Math.sqrt(rms / SIZE);
        if (rms < 0.01) return -1; // Too quiet

        let r1 = 0, r2 = SIZE - 1, thres = 0.2;
        for (let i = 0; i < SIZE / 2; i++) {
            if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
        }
        for (let i = 1; i < SIZE / 2; i++) {
            if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }
        }

        const buf = buffer.slice(r1, r2);
        SIZE = buf.length;

        const c = new Array(SIZE).fill(0);
        for (let i = 0; i < SIZE; i++) {
            for (let j = 0; j < SIZE - i; j++) {
                c[i] = c[i] + buf[j] * buf[j + i];
            }
        }

        let d = 0;
        while (c[d] > c[d + 1]) d++;
        let maxval = -1, maxpos = -1;
        for (let i = d; i < SIZE; i++) {
            if (c[i] > maxval) {
                maxval = c[i];
                maxpos = i;
            }
        }
        let T0 = maxpos;

        return sampleRate / T0;
    }
}