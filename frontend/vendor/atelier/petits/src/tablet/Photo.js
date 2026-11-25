//////////////////////////////////////////////////
//  Taking a picture (Atelier, written for Foyer)
//
//  In the paint editor a shape can be filled with a picture. The native
//  application showed the camera behind a picture of the drawing with a hole
//  where the shape is, and so does this: a <video> fed by the camera of the
//  browser, under that mask, both placed over the drawing.
//
//  The picture kept is the part of the camera seen through the shape, reduced
//  (1024 points at most on its long side) and written as JPEG: a photograph in
//  PNG would weigh ten times more in the drawing, and in the room of the child.
//////////////////////////////////////////////////

const MAX_SIDE = 1024;
const QUALITY = 0.85;

let stream = null;
let holder = null;
let video = null;
let frame = null; // what the editor asked for: where the shape is, and how big
let facing = 'user';

function stopStream () {
    if (stream) {
        stream.getTracks().forEach(function (track) {
            track.stop();
        });
        stream = null;
    }
}

function open () {
    stopStream();
    return navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: facing}}).then(function (got) {
        stream = got;
        if (!video) {
            return;
        }
        video.srcObject = stream;
        // The camera that faces the child is shown as a mirror, as every camera application does
        video.style.transform = (facing == 'user') ? 'scaleX(-1)' : '';
        video.play();
    });
}

export default class Photo {
    static get supported () {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    // data: the box of the shape on the screen (x, y, width, height, before 'scale'
    // is applied around its centre), the drawing area (mx, my, mw, mh) and the
    // mask (image, a picture of the drawing with a hole). Rejects when the camera
    // is refused or missing.
    static start (data, parent) {
        Photo.stop();
        frame = data;
        var scale = data.scale || 1;
        // The drawing area as the paint editor shows it: scaled around its centre
        var left = data.mx + (data.mw - data.mw * scale) / 2;
        var top = data.my + (data.mh - data.mh * scale) / 2;
        holder = document.createElement('div');
        holder.setAttribute('id', 'atelier-photo');
        holder.style.cssText = 'position:fixed;overflow:hidden;background:#000;' +
            'left:' + left + 'px;top:' + top + 'px;width:' + (data.mw * scale) + 'px;height:' + (data.mh * scale) + 'px;';
        video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.muted = true;
        var width = data.width * scale;
        var height = data.height * scale;
        video.style.cssText = 'position:absolute;object-fit:cover;' +
            'left:' + (data.x + data.width / 2 - width / 2 - left) + 'px;top:' + (data.y + data.height / 2 - height / 2 - top) + 'px;' +
            'width:' + width + 'px;height:' + height + 'px;';
        holder.appendChild(video);
        var mask = document.createElement('img');
        mask.src = data.image;
        mask.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;';
        holder.appendChild(mask);
        // First in its parent: the buttons of the camera, added after, stay above
        parent.insertBefore(holder, parent.firstChild);
        facing = 'user';
        return open();
    }

    // 'front' faces the child, 'back' looks away
    static choose (view) {
        facing = (view == 'back') ? 'environment' : 'user';
        return open();
    }

    // The part of the camera seen through the shape, as base64 JPEG; null when nothing is shown yet
    static capture () {
        if (!video || !frame || !video.videoWidth) {
            return null;
        }
        var k = Math.min(2, MAX_SIDE / Math.max(frame.width, frame.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(frame.width * k);
        canvas.height = Math.round(frame.height * k);
        var ctx = canvas.getContext('2d');
        // Same framing as on the screen (object-fit: cover): fill the box, cut what exceeds
        var ratio = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        var w = video.videoWidth * ratio;
        var h = video.videoHeight * ratio;
        if (facing == 'user') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        return canvas.toDataURL('image/jpeg', QUALITY).split(',')[1];
    }

    // Lets go of the camera: its indicator goes off
    static stop () {
        stopStream();
        if (holder && holder.parentNode) {
            holder.parentNode.removeChild(holder);
        }
        holder = null;
        video = null;
        frame = null;
    }
}
