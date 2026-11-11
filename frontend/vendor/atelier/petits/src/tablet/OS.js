import Web from './Web';
import ScratchAudio from '../utils/ScratchAudio';

//////////////////////////////////////////////////
//  Tablet interface functions
//
//  Atelier: the original delegated to a native bridge (iOS.js or Android.js)
//  injected in a web view. The only bridge is now Web.js, which runs in the
//  browser. This facade keeps the names the editor calls. The functions that
//  sent SQL to the native database (stmt, query, setfield) are replaced by named
//  operations on projects and on the child's own assets; analytics, the native
//  splash screen, the share dialog and the device name are removed.
//////////////////////////////////////////////////

let path;
let camera;

export default class OS {
    // Getters/setters for properties used in other classes
    static get path () {
        return path;
    }

    static set path (newPath) {
        path = newPath;
    }

    static get camera () {
        return camera;
    }

    static set camera (newCamera) {
        camera = newCamera;
    }

    // The bridge is part of the bundle: nothing to wait for.
    static waitForInterface (fcn) {
        if (fcn) {
            fcn();
        }
    }

    // Projects. Rows are returned as JSON strings, in the shape the editor already parses.
    static projectGet (id, fcn) {
        Web.projectGet(id, fcn);
    }

    static projectCreate (obj, fcn) {
        Web.projectCreate(obj, fcn);
    }

    static projectSave (obj, fcn) {
        Web.projectSave(obj, fcn);
    }

    static projectRename (id, name, fcn) {
        Web.projectRename(id, name, fcn);
    }

    static projectList (fcn) {
        Web.projectList(fcn);
    }

    // The child's own characters ('usershapes') and backgrounds ('userbkgs')
    static assetList (kind, fcn) {
        Web.assetList(kind, fcn);
    }

    static assetFind (kind, field, value, fcn) {
        Web.assetFind(kind, field, value, fcn);
    }

    static assetAdd (kind, record, fcn) {
        Web.assetAdd(kind, record, fcn);
    }

    static assetRemove (kind, id, fcn) {
        Web.assetRemove(kind, id, fcn);
    }

    // IO functions

    static cleanassets (ft, fcn) {
        Web.cleanassets(ft, fcn);
    }

    static getsettings (fcn) {
        Web.getsettings(fcn);
    }

    static getmedia (file, fcn) {
        Web.getmedia(file, fcn);
    }

    static setmedia (str, ext, fcn) {
        Web.setmedia(str, ext, fcn);
    }

    static setmedianame (str, name, ext, fcn) {
        Web.setmedianame(str, name, ext, fcn);
    }

    static getmd5 (str, fcn) {
        Web.getmd5(str, fcn);
    }

    static remove (str, fcn) {
        Web.remove(str, fcn);
    }

    // Sound functions

    static registerSound (dir, name, fcn) {
        Web.registerSound(dir, name, fcn);
    }

    static playSound (name, fcn) {
        Web.playSound(name, fcn);
    }

    static stopSound (name, fcn) {
        Web.stopSound(name, fcn);
    }

    // Called by the bridge when a sound has finished playing
    static soundDone (name) {
        ScratchAudio.soundDone(name);
    }

    static sndrecord (fcn) {
        Web.sndrecord(fcn);
    }

    static recordstop (fcn) {
        Web.recordstop(fcn);
    }

    static volume (fcn) {
        Web.volume(fcn);
    }

    static startplay (fcn) {
        Web.startplay(fcn);
    }

    static stopplay (fcn) {
        Web.stopplay(fcn);
    }

    static recorddisappear (b, fcn) {
        Web.recorddisappear(b, fcn);
    }

    // Record state
    static askpermission () {
        Web.askpermission();
    }

    // camera functions

    static hascamera () {
        camera = Web.hascamera();
    }

    static startfeed (data, fcn) {
        Web.startfeed(data, fcn);
    }

    static stopfeed (fcn) {
        Web.stopfeed(fcn);
    }

    static choosecamera (mode, fcn) {
        Web.choosecamera(mode, fcn);
    }

    static captureimage (fcn) {
        Web.captureimage(fcn);
    }

    static trace (str) {
        console.log(str); // eslint-disable-line no-console
    }

    static duplicateAsset (path, name, fcn) {
        Web.duplicateAsset(path, name, fcn);
    }
}

Web.onSoundDone = OS.soundDone;
