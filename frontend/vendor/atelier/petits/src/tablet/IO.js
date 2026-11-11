import OS from './OS';
import MediaLib from './MediaLib';
import {setCanvasSize, drawThumbnail} from '../utils/lib';
import SVG2Canvas from '../utils/SVG2Canvas';

export default class IO {
    /**
     * Synchronous requests are normally not recommended, but in this case we're
     * going to file URLs so this should be okay.
     */
    static requestSynchronous (url) {
        var request = new XMLHttpRequest();
        request.open('GET', url, false);
        request.send(null);
        if (request.status === 0 || request.status === 200) {
            return request.responseText;
        } else {
            // Failed synchronous loading
            return '';
        }
    }

    static requestFromServer (url, whenDone) {
        var xmlrequest = new XMLHttpRequest();
        xmlrequest.addEventListener('error', transferFailed, false);
        xmlrequest.onreadystatechange = function () {
            if (xmlrequest.readyState == 4) {
                whenDone(xmlrequest.responseText);
            }
        };
        xmlrequest.open('GET', url, true);
        xmlrequest.send(null);
        function transferFailed (e) {
            e.preventDefault();
            e.stopPropagation();
            // Failed loading
        }
    }

    static getThumbnail (str, w, h, destw, desth) {
        str = str.replace(/>\s*</g, '><');
        var xmlDoc = new DOMParser().parseFromString(str, 'text/xml');
        var extxml = document.importNode(xmlDoc.documentElement, true);
        if (extxml.childNodes[0].nodeName == '#comment') {
            extxml.removeChild(extxml.childNodes[0]);
        }
        var srccnv = document.createElement('canvas');
        setCanvasSize(srccnv, w, h);
        var ctx = srccnv.getContext('2d');
        for (var i = 0; i < extxml.childElementCount; i++) {
            SVG2Canvas.drawLayer(extxml.childNodes[i], ctx);
        }
        if (!destw || !desth) {
            return srccnv.toDataURL('image/png');
        }
        var cnv = document.createElement('canvas');
        setCanvasSize(cnv, destw, desth);
        drawThumbnail(srccnv, cnv);
        return cnv.toDataURL('image/png');
    }

    // in iOS casting an svg url in a img.src works except when the SVG has images.
    // This code avoids that bug
    // also when in debug mode you need to get the base64 to avoid sandboxing issues
    static getAsset (md5, fcn) { // returns either a link or a base64 dataurl
        if (MediaLib.keys[md5]) {
            fcn(MediaLib.path + md5); return;
        } // just url link assets do not have photos
        if (md5.indexOf('/') > -1) {
            IO.requestFromServer(md5, gotit); // get url contents
            return;
        }

        OS.getmedia(md5, nextStep);

        function gotit (str) {
            var base64 = IO.getImageDataURL(md5, btoa(str));
            if (str.indexOf('xlink:href') < 0) {
                fcn(md5); // does not have embedded images
            } else {
                IO.getImagesInSVG(str, function () {
                    fcn(base64);
                });
            } // base64 dataurl
        }

        function nextStep (dataurl) {
            var str = atob(dataurl);
            var base64 = IO.getImageDataURL(md5, dataurl);
            IO.getImagesInSVG(str, function () {
                fcn(base64);
            });
        }
    }

    static getImagesInSVG (str, whenDone) {
        str = str.replace(/>\s*</g, '><');
        if (str.indexOf('xlink:href') < 0) {
            whenDone(); // needs this in case of reading a PNG in debug mode
        } else {
            loadInnerImages(str, whenDone);
        }

        function loadInnerImages (str, whenDone) {
            var xmlDoc = new DOMParser().parseFromString(str, 'text/xml');
            var extxml = document.importNode(xmlDoc.documentElement, true);
            if (extxml.childNodes[0].nodeName == '#comment') {
                extxml.removeChild(extxml.childNodes[0]);
            }
            var images = IO.getImages(extxml, []);
            var imageCount = images.length;
            for (var i = 0; i < images.length; i++) {
                var dataurl = images[i].getAttribute('xlink:href');
                var svgimg = document.createElement('img');
                svgimg.src = dataurl;
                if (!svgimg.complete) {
                    svgimg.onload = function () {
                        readToLad();
                    };
                } else {
                    readToLad();
                }
            }

            function readToLad () {
                imageCount--;
                if (imageCount < 1) {
                    extxml = null;
                    xmlDoc = null;
                    whenDone();
                }
            }
        }
    }

    static getImages (p, res) {
        for (var i = 0; i < p.childNodes.length; i++) {
            var elem = p.childNodes[i];
            if (elem.nodeName == 'metadata') {
                continue;
            }
            if (elem.nodeName == 'defs') {
                continue;
            }
            if (elem.nodeName == 'sodipodi:namedview') {
                continue;
            }
            if (elem.nodeName == '#comment') {
                continue;
            }
            if (elem.nodeName == 'image') {
                res.push(elem);
            }
            if (elem.nodeName == 'g') {
                IO.getImages(elem, res);
            }
        }
        return res;
    }
    static getImageDataURL (md5, data) {
        var header = '';
        switch (IO.getExtension(md5)) {
        case 'svg': header = 'data:image/svg+xml;base64,';
            break;
        case 'png': header = 'data:image/png;base64,';
            break;
        }
        return header + data;
    }

    // Atelier: the original built SQL statements here and sent them to the native
    // database. The bridge now offers named operations only (see OS.js and Web.js).
    static getObject (md5, fcn) {
        if (md5.indexOf('/') > -1) {
            IO.requestFromServer(md5, fcn);
        } else {
            OS.projectGet(md5, fcn);
        }
    }

    static setMedia (data, type, fcn) {
        OS.setmedia(btoa(data), type, fcn);
    }

    ////////////////////////
    // projects
    ///////////////////////

    static createProject (obj, fcn) {
        OS.projectCreate({
            name: obj.name,
            version: obj.version,
            json: obj.json ? JSON.stringify(obj.json) : null,
            thumbnail: obj.thumbnail ? JSON.stringify(obj.thumbnail) : null
        }, fcn);
    }

    static saveProject (obj, fcn) {
        OS.projectSave({
            id: obj.id,
            version: obj.version,
            name: obj.name,
            json: JSON.stringify(obj.json),
            thumbnail: JSON.stringify(obj.thumbnail)
        }, fcn);
    }

    static getExtension (str) {
        return str.substring(str.indexOf('.') + 1, str.length);
    }

    static getFilename (str) {
        return str.substring(0, str.indexOf('.'));
    }

    static getFilenameWithExt (str) {
        return str.substring(str.lastIndexOf('/') + 1, str.length);
    }

    static parseProjectData (data) {
        var res = new Object();
        for (var key in data) {
            res[key.toLowerCase()] = data[key];
        }
        return res;
    }

    static uniqueProjectName (jsonData, callback, useOne) {
        // Ensure the project name is not a duplicate

        // Split project name from trailing number
        // Returns [project name, number]
        // E.g., "Project 2" -> ["Project", 2]
        // "My project" -> ["My project", null];
        var nameAndNumber = function (name) {
            var splitName = name.split(' ');
            var lastPart = splitName.pop();
            if (!isNaN(lastPart)) {
                return {
                    'name': splitName.join(' '),
                    'number': parseInt(lastPart)
                };
            } else {
                return {
                    'name': name,
                    'number': null
                };
            }
        };

        var giftProjectNameParts = nameAndNumber(jsonData.name);

        // Get project names already existing in the DB
        OS.projectList(function (existingProjects) {
            var newNumber = null;

            existingProjects = JSON.parse(existingProjects);
            for (var i = 0; i < existingProjects.length; i++) {
                var existingProjectName = IO.parseProjectData(existingProjects[i]).name;
                var existingProjectNameParts = nameAndNumber(existingProjectName);
                if (giftProjectNameParts.name == existingProjectNameParts.name) {
                    if (existingProjectNameParts.number != null) {
                        // "My project 2" -> "My project 3"
                        newNumber = existingProjectNameParts.number + 1;
                    } else {
                        // "My project" -> "My project 2"
                        newNumber = 2;
                    }
                }

            }

            if (newNumber != null && (!giftProjectNameParts.number || newNumber > giftProjectNameParts.number)) {
                // A duplicate project name exists - update it
                jsonData.name = giftProjectNameParts.name + ' ' + newNumber;
            } else if (useOne) {
                jsonData.name = giftProjectNameParts.name + ' 1';
            }
            callback(jsonData);
        });
    }

}
