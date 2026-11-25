//////////////////////////////////////////////////
//  Recording a sound (Atelier, written for Foyer)
//
//  What the native application did with the recorder of the tablet, done with
//  the microphone of the browser: the samples are captured as they come, kept
//  in memory, played back on request and turned into a WAV file when the child
//  keeps the sound. WAV, because every browser reads it and none needs a codec
//  to write it: Safari and Chrome do not record the same compressed formats.
//
//  The microphone is asked for at the first recording, by the browser itself.
//  It is released as soon as the recording stops: its indicator goes off.
//////////////////////////////////////////////////

const CHUNK = 4096;
// A voice does not need more: halves the weight of the file
const MAX_RATE = 24000;

let stream = null;
let source = null;
let tap = null;
let chunks = [];
let rate = 0;
let level = 0;
let player = null;

function release () {
    if (tap) {
        tap.onaudioprocess = null;
        tap.disconnect();
        tap = null;
    }
    if (source) {
        source.disconnect();
        source = null;
    }
    if (stream) {
        stream.getTracks().forEach(function (track) {
            track.stop();
        });
        stream = null;
    }
    level = 0;
}

// The samples recorded so far, in one piece
function samples () {
    var length = chunks.reduce(function (n, c) {
        return n + c.length;
    }, 0);
    var all = new Float32Array(length);
    var at = 0;
    chunks.forEach(function (c) {
        all.set(c, at);
        at += c.length;
    });
    return all;
}

export default class Micro {
    // Whether this browser can record at all (an old one, or a page not served over HTTPS, cannot)
    static get supported () {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    // Starts a recording on the audio context of the editor. Rejects when the
    // microphone is refused or missing.
    static start (audio) {
        Micro.discard();
        if (!Micro.supported) {
            return Promise.reject(new Error('unsupported'));
        }
        return navigator.mediaDevices.getUserMedia({audio: true}).then(function (got) {
            stream = got;
            // Keep one sample out of 'step', averaged: 48000 Hz becomes 24000 Hz
            var step = Math.max(1, Math.floor(audio.sampleRate / MAX_RATE));
            rate = audio.sampleRate / step;
            source = audio.createMediaStreamSource(stream);
            tap = audio.createScriptProcessor(CHUNK, 1, 1);
            tap.onaudioprocess = function (e) {
                var input = e.inputBuffer.getChannelData(0);
                var kept = new Float32Array(Math.floor(input.length / step));
                var sum = 0;
                for (var i = 0; i < kept.length; i++) {
                    var v = 0;
                    for (var j = 0; j < step; j++) {
                        v += input[i * step + j];
                    }
                    kept[i] = v / step;
                    sum += kept[i] * kept[i];
                }
                chunks.push(kept);
                // A quiet voice still has to move the indicator: the square root spreads the low levels
                level = Math.min(1, Math.sqrt(Math.sqrt(sum / (kept.length || 1))) * 1.4);
            };
            source.connect(tap);
            // A processor only runs when it leads somewhere; it writes nothing, so nothing is heard
            tap.connect(audio.destination);
        });
    }

    // Between 0 and 1, while recording
    static get level () {
        return level;
    }

    static get recording () {
        return !!tap;
    }

    static get seconds () {
        return rate ? samples().length / rate : 0;
    }

    static stop () {
        release();
    }

    // Plays what was recorded; resolves with its duration in seconds
    static play (audio) {
        Micro.stopPlaying();
        var all = samples();
        if (!all.length) {
            return 0;
        }
        var buffer = Micro.buffer(audio);
        player = audio.createBufferSource();
        player.buffer = buffer;
        player.connect(audio.destination);
        player.start();
        return buffer.duration;
    }

    static stopPlaying () {
        if (player) {
            try {
                player.stop();
            } catch (e) {
                // already ended
            }
            player = null;
        }
    }

    // What was recorded, ready to be played by the editor without reading the file back
    static buffer (audio) {
        var all = samples();
        var buffer = audio.createBuffer(1, Math.max(1, all.length), rate || audio.sampleRate);
        buffer.getChannelData(0).set(all);
        return buffer;
    }

    // What was recorded, as a WAV file: 16 bits, one channel
    static wav () {
        var all = samples();
        var bytes = new DataView(new ArrayBuffer(44 + all.length * 2));
        var text = function (at, str) {
            for (var i = 0; i < str.length; i++) {
                bytes.setUint8(at + i, str.charCodeAt(i));
            }
        };
        text(0, 'RIFF');
        bytes.setUint32(4, 36 + all.length * 2, true);
        text(8, 'WAVEfmt ');
        bytes.setUint32(16, 16, true);
        bytes.setUint16(20, 1, true); // PCM
        bytes.setUint16(22, 1, true); // one channel
        bytes.setUint32(24, Math.round(rate), true);
        bytes.setUint32(28, Math.round(rate) * 2, true);
        bytes.setUint16(32, 2, true);
        bytes.setUint16(34, 16, true);
        text(36, 'data');
        bytes.setUint32(40, all.length * 2, true);
        for (var i = 0; i < all.length; i++) {
            var v = Math.max(-1, Math.min(1, all[i]));
            bytes.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
        }
        return new Uint8Array(bytes.buffer);
    }

    // Forgets the recording and lets go of the microphone
    static discard () {
        Micro.stopPlaying();
        release();
        chunks = [];
        rate = 0;
    }
}
