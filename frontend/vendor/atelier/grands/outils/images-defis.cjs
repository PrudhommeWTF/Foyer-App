// Atelier (Foyer): draws the pictures of the guided challenges (foyer/defis.json).
//
// Each step of a challenge shows the script as it stands at that step. The
// pictures are not drawn by hand: this tool writes each script into a project of
// the Atelier, opens it in the editor itself and photographs its blocks. They are
// therefore always the real blocks, in French, as the child will see them.
//
// Run by hand when a challenge changes, against a Foyer that serves the editor
// (a development one: it creates and deletes a project there):
//
//   FOYER_URL=http://localhost:3000 FOYER_EMAIL=… FOYER_PASSWORD=… node images-defis.cjs
//
// Needs Playwright with a Chromium. Writes surcouche/…/foyer/defis/*.png, then
// construire.sh puts them in the editor.
const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');

const OUT = path.join(__dirname, '..', 'surcouche', 'packages', 'scratch-gui', 'src', 'foyer', 'defis');
const URL_ = (process.env.FOYER_URL || '').replace(/\/$/, '');
if (!URL_ || !process.env.FOYER_EMAIL || !process.env.FOYER_PASSWORD) {
    console.error('FOYER_URL, FOYER_EMAIL and FOYER_PASSWORD are needed.');
    process.exit(1);
}

// The scripts of each step, in a short notation: a script is a list of blocks,
// a block is [name, ...values], and a loop takes the blocks it holds as its last value.
const flag = ['flag'];
const clicked = ['clicked'];
const key = (k, block) => [['key', k], block];
const catchMe = [flag, ['forever', [['gotorandom'], ['wait', 1]]]];
const STEPS = {
    traverser: [
        [[flag]],
        [[flag, ['gotoxy', -200, 0]]],
        [[flag, ['gotoxy', -200, 0], ['repeat', 40, []]]],
        [[flag, ['gotoxy', -200, 0], ['repeat', 40, [['move', 10]]]]],
        [[flag, ['gotoxy', -200, 0], ['repeat', 40, [['move', 10]]]]]
    ],
    bonjour: [
        [[clicked]],
        [[clicked, ['say', 'Bonjour !', 2]]],
        [[clicked, ['say', 'Bonjour !', 2], ['play', 'pop']]],
        [[clicked, ['say', 'Bonjour !', 2], ['play', 'pop']]],
        [[clicked, ['say', 'Bonjour !', 2], ['play', 'pop']]]
    ],
    danser: [
        [[flag]],
        [[flag, ['forever', []]]],
        [[flag, ['forever', [['nextcostume'], ['wait', 0.3]]]]],
        [[flag, ['forever', [['nextcostume'], ['wait', 0.3]]]]],
        [[flag, ['forever', [['nextcostume'], ['wait', 0.3]]]]]
    ],
    clavier: [
        [[['key', 'right arrow']]],
        [key('right arrow', ['changex', 10])],
        [key('right arrow', ['changex', 10]), key('left arrow', ['changex', -10])],
        [key('right arrow', ['changex', 10]), key('left arrow', ['changex', -10]),
            key('up arrow', ['changey', 10]), key('down arrow', ['changey', -10])],
        [key('right arrow', ['changex', 10]), key('left arrow', ['changex', -10]),
            key('up arrow', ['changey', 10]), key('down arrow', ['changey', -10])]
    ],
    rebondir: [
        [[flag, ['forever', []]]],
        [[flag, ['forever', [['move', 10]]]]],
        [[flag, ['forever', [['move', 10], ['bounce']]]]],
        [[flag, ['rotstyle', 'left-right'], ['forever', [['move', 10], ['bounce']]]]],
        [[flag, ['rotstyle', 'left-right'], ['forever', [['move', 10], ['bounce']]]]]
    ],
    couleur: [
        [[clicked]],
        [[clicked, ['repeat', 20, []]]],
        [[clicked, ['repeat', 20, [['changeeffect', 10], ['wait', 0.1]]]]],
        [[clicked, ['repeat', 20, [['changeeffect', 10], ['wait', 0.1]]], ['cleareffects']]],
        [[clicked, ['repeat', 20, [['changeeffect', 10], ['wait', 0.1]]], ['cleareffects']]]
    ],
    suivre: [
        [[flag, ['forever', []]]],
        [[flag, ['forever', [['pointmouse']]]]],
        [[flag, ['forever', [['pointmouse'], ['move', 5]]]]],
        [[flag, ['forever', [['pointmouse'], ['move', 5]]]]]
    ],
    // The first step adds the extension: no script to show yet
    dessiner: [
        [],
        [[flag, ['penclear'], ['pendown']]],
        [[flag, ['penclear'], ['pendown'], ['repeat', 4, []]]],
        [[flag, ['penclear'], ['pendown'], ['repeat', 4, [['move', 100], ['turn', 90]]]]],
        [[flag, ['penclear'], ['pendown'], ['repeat', 4, [['move', 100], ['turn', 90]]]]]
    ],
    video: [
        [],
        [[['motion', 10]]],
        [[['motion', 10], ['play', 'pop'], ['gotorandom']]],
        [[['motion', 10], ['play', 'pop'], ['gotorandom']]]
    ],
    score: [
        [[['setvar', 0]]],
        [[flag, ['setvar', 0]]],
        [[flag, ['setvar', 0]], catchMe],
        [[flag, ['setvar', 0]], catchMe, [clicked, ['changevar', 1]]],
        [[flag, ['setvar', 0]], catchMe, [clicked, ['changevar', 1]]]
    ]
};

const VAR = 'atelier-score';
const num = (kind, v) => [1, [kind, String(v)]];

// Turns the short notation into the blocks of a project file
const build = scripts => {
    const blocks = {};
    let count = 0;
    const add = (list, parent, top) => {
        let first = null;
        let previous = null;
        list.forEach(([name, ...v]) => {
            const id = `b${count++}`;
            const b = {opcode: '', next: null, parent: previous || parent, inputs: {}, fields: {}, shadow: false, topLevel: false};
            const menu = (opcode, field, value) => {
                const mid = `b${count++}`;
                blocks[mid] = {opcode, next: null, parent: id, inputs: {}, fields: {[field]: [value, null]}, shadow: true, topLevel: false};
                return [1, mid];
            };
            switch (name) {
            case 'flag': b.opcode = 'event_whenflagclicked'; break;
            case 'clicked': b.opcode = 'event_whenthisspriteclicked'; break;
            case 'motion': b.opcode = 'videoSensing_whenMotionGreaterThan'; b.inputs.REFERENCE = num(4, v[0]); break;
            case 'key': b.opcode = 'event_whenkeypressed'; b.fields.KEY_OPTION = [v[0], null]; break;
            case 'gotoxy': b.opcode = 'motion_gotoxy'; b.inputs.X = num(4, v[0]); b.inputs.Y = num(4, v[1]); break;
            case 'move': b.opcode = 'motion_movesteps'; b.inputs.STEPS = num(4, v[0]); break;
            case 'turn': b.opcode = 'motion_turnright'; b.inputs.DEGREES = num(4, v[0]); break;
            case 'bounce': b.opcode = 'motion_ifonedgebounce'; break;
            case 'rotstyle': b.opcode = 'motion_setrotationstyle'; b.fields.STYLE = [v[0], null]; break;
            case 'pointmouse': b.opcode = 'motion_pointtowards'; b.inputs.TOWARDS = menu('motion_pointtowards_menu', 'TOWARDS', '_mouse_'); break;
            case 'changeeffect': b.opcode = 'looks_changeeffectby'; b.fields.EFFECT = ['COLOR', null]; b.inputs.CHANGE = num(4, v[0]); break;
            case 'cleareffects': b.opcode = 'looks_cleargraphiceffects'; break;
            case 'penclear': b.opcode = 'pen_clear'; break;
            case 'pendown': b.opcode = 'pen_penDown'; break;
            case 'changex': b.opcode = 'motion_changexby'; b.inputs.DX = num(4, v[0]); break;
            case 'changey': b.opcode = 'motion_changeyby'; b.inputs.DY = num(4, v[0]); break;
            case 'gotorandom': b.opcode = 'motion_goto'; b.inputs.TO = menu('motion_goto_menu', 'TO', '_random_'); break;
            case 'say': b.opcode = 'looks_sayforsecs'; b.inputs.MESSAGE = num(10, v[0]); b.inputs.SECS = num(4, v[1]); break;
            case 'nextcostume': b.opcode = 'looks_nextcostume'; break;
            case 'play': b.opcode = 'sound_playuntildone'; b.inputs.SOUND_MENU = menu('sound_sounds_menu', 'SOUND_MENU', v[0]); break;
            case 'wait': b.opcode = 'control_wait'; b.inputs.DURATION = num(5, v[0]); break;
            case 'repeat': b.opcode = 'control_repeat'; b.inputs.TIMES = num(6, v[0]); break;
            case 'forever': b.opcode = 'control_forever'; break;
            case 'setvar': b.opcode = 'data_setvariableto'; b.fields.VARIABLE = ['score', VAR]; b.inputs.VALUE = num(10, v[0]); break;
            case 'changevar': b.opcode = 'data_changevariableby'; b.fields.VARIABLE = ['score', VAR]; b.inputs.VALUE = num(4, v[0]); break;
            default: throw new Error(`unknown block ${name}`);
            }
            blocks[id] = b;
            if (name === 'repeat' || name === 'forever') {
                const inner = add(v[v.length - 1], id, null);
                if (inner) b.inputs.SUBSTACK = [2, inner];
            }
            if (previous) blocks[previous].next = id;
            else {
                first = id;
                if (top) Object.assign(b, {topLevel: true, x: top[0], y: top[1]});
            }
            previous = id;
        });
        return first;
    };
    // The card of a challenge is low and wide: one script under the other while
    // they fit, then in two columns. The height of a script is estimated generously
    // (a block, and the foot of a loop): too much room between two scripts shows
    // less than one drawn over the other.
    const height = list => list.reduce((h, block) => {
        const inner = Array.isArray(block[block.length - 1]) ? block[block.length - 1] : null;
        return h + 40 + (inner ? 50 + height(inner) : 0);
    }, 0);
    const total = scripts.reduce((h, script) => h + height(script) + 60, 0);
    const columns = total > 300 ? 2 : 1;
    const y = [20, 20];
    scripts.forEach(script => {
        // The next script goes to the shorter column
        const c = columns === 2 && y[1] < y[0] ? 1 : 0;
        // In the units of the workspace, which the editor shows smaller: wider than the widest script
        add(script, null, [20 + (c * 400), y[c]]);
        y[c] += height(script) + 60;
    });
    return blocks;
};

const asset = (id, name, extra) => ({assetId: id, name, md5ext: `${id}.svg`, dataFormat: 'svg', ...extra});
const POP = {assetId: '83a9787d4cb6f3b7632b4ddfebf74367', name: 'pop', dataFormat: 'wav', format: '', rate: 11025, sampleCount: 258,
    md5ext: '83a9787d4cb6f3b7632b4ddfebf74367.wav'};
const project = scripts => JSON.stringify({
    targets: [
        {isStage: true, name: 'Stage', variables: {[VAR]: ['score', 0]}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
            costumes: [asset('fdea9761cb28cff2c09d747ad301a5e7', 'arrière-plan1', {rotationCenterX: 240, rotationCenterY: 180})],
            sounds: [POP], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null},
        {isStage: false, name: 'Boulon', variables: {}, lists: {}, broadcasts: {}, blocks: build(scripts), comments: {}, currentCostume: 0,
            costumes: ['04fbbd28126392edae071a9cb1dea521', '60202659746c562e77a43b5ae94f4667', 'b207f5ce9a85590e91b29c50941b957c'].map(
                (id, i) => asset(id, `costume${i + 1}`, {bitmapResolution: 1, rotationCenterX: 60, rotationCenterY: 76})
            ),
            sounds: [POP], volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'}
    ],
    monitors: [], extensions: [['"motion"', 'videoSensing'], ['"pendown"', 'pen']].filter(e => JSON.stringify(scripts).includes(e[0])).map(e => e[1]), meta: {semver: '3.0.0', vm: '0.2.0', agent: 'Foyer'}
});

(async () => {
    const browser = await chromium.launch();
    // A wide window: the scripts drawn in two columns must fit in the workspace to be photographed whole
    const context = await browser.newContext({viewport: {width: 1900, height: 1100}, deviceScaleFactor: 2});
    const api = (method, p, data) => context.request[method](`${URL_}/api${p}`, data ? {data} : undefined);
    if ((await api('post', '/auth/login', {email: process.env.FOYER_EMAIL, password: process.env.FOYER_PASSWORD})).status() !== 200) {
        throw new Error('login refused');
    }
    const created = (await (await api('post', '/atelier/projets', {name: 'Images des défis', level: 'grands'})).json()).projet;
    let rev = created.rev;
    const page = await context.newPage();
    fs.rmSync(OUT, {recursive: true, force: true});
    fs.mkdirSync(OUT, {recursive: true});
    const images = {};
    const seen = {};
    for (const [id, steps] of Object.entries(STEPS)) {
        images[id] = [];
        for (let i = 0; i < steps.length; i++) {
            // A step without any script has no picture
            if (!steps[i].length) {
                images[id].push(null);
                continue;
            }
            const json = project(steps[i]);
            // A step that changes nothing shows the picture of the one before
            if (seen[json]) {
                images[id].push(seen[json]);
                continue;
            }
            const saved = await api('put', `/atelier/projets/${created.id}`, {rev, name: 'Images des défis', json});
            if (saved.status() !== 200) throw new Error(`save refused: ${await saved.text()}`);
            rev = (await saved.json()).projet.rev;
            await page.goto(`${URL_}/atelier/grands/editor.html?projet=${created.id}`);
            await page.waitForSelector('.blocklyBlockCanvas .blocklyDraggable', {timeout: 60000});
            await page.waitForTimeout(1500);
            const box = await page.evaluate(() => {
                const r = document.querySelector('.blocklyWorkspace .blocklyBlockCanvas').getBoundingClientRect();
                return {x: r.x, y: r.y, width: r.width, height: r.height};
            });
            const name = `${id}-${i + 1}.png`;
            await page.screenshot({path: path.join(OUT, name),
                clip: {x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20}});
            seen[json] = name;
            images[id].push(name);
            console.log(name, Math.round(box.width), 'x', Math.round(box.height));
        }
    }
    await api('delete', `/atelier/projets/${created.id}`);
    await browser.close();
    // The pictures of each challenge, step by step, next to its text
    const file = path.join(OUT, '..', 'defis.json');
    const defis = JSON.parse(fs.readFileSync(file, 'utf8'));
    defis.forEach(d => {
        if (!images[d.id] || images[d.id].length !== d.steps.length) throw new Error(`steps of '${d.id}' and their pictures do not match`);
        d.images = images[d.id];
    });
    fs.writeFileSync(file, `${JSON.stringify(defis, null, 1)}\n`);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
