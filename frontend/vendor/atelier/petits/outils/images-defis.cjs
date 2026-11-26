// Atelier (Foyer): draws the pictures of the guided challenges (www/defis/defis.json).
//
// A challenge of this level is one picture: the script to rebuild. The pictures are
// not drawn by hand: this tool writes each script into a project of the Atelier,
// opens it in the editor itself and photographs its blocks. They are therefore
// always the real blocks, as the child will see them.
//
// Run by hand when a challenge changes, against a Foyer that serves the editor
// (a development one: it creates and deletes a project there):
//
//   FOYER_URL=http://localhost:3000 FOYER_EMAIL=… FOYER_PASSWORD=… node images-defis.cjs
//
// Needs Playwright with a Chromium. Writes www/defis/*.png.
const fs = require('fs');
const path = require('path');
const {chromium} = require('playwright');

const OUT = path.join(__dirname, '..', 'www', 'defis');
const URL_ = (process.env.FOYER_URL || '').replace(/\/$/, '');
if (!URL_ || !process.env.FOYER_EMAIL || !process.env.FOYER_PASSWORD) {
    console.error('FOYER_URL, FOYER_EMAIL and FOYER_PASSWORD are needed.');
    process.exit(1);
}

// The script of each challenge: a list of [block, value], and a loop takes the
// blocks it holds as a third entry.
const SCRIPTS = {
    'avance': [['onflag'], ['forward', 4], ['endstack']],
    'saute': [['onclick'], ['hop', 2], ['endstack']],
    'danse': [['onflag'], ['repeat', 4, [['hop', 2], ['right', 3]]], ['endstack']],
    'grandit': [['onclick'], ['grow', 4], ['playsnd', 'pop.mp3'], ['shrink', 4], ['endstack']],
    'sans-fin': [['onflag'], ['forward', 2], ['back', 2], ['forever']]
};

// The editor's own format: [name, value, x, y], the blocks of a loop as a fifth entry
function place (blocks, x) {
    return blocks.map(function (b) {
        const row = [b[0], b.length > 1 ? b[1] : 'null', x, 40];
        if (b[2]) {
            row.push(place(b[2], x + 30));
            x += 70 * b[2].length;
        }
        x += 70;
        return row;
    });
}

(async function () {
    const defis = JSON.parse(fs.readFileSync(path.join(OUT, 'defis.json'), 'utf8'));
    const start = JSON.parse(fs.readFileSync(path.join(OUT, '..', 'samples', 'exemples.json'), 'utf8'))[0].json;
    const browser = await chromium.launch();
    const context = await browser.newContext({viewport: {width: 1366, height: 1024}, deviceScaleFactor: 2});
    const login = await context.request.post(URL_ + '/api/auth/login',
        {data: {email: process.env.FOYER_EMAIL, password: process.env.FOYER_PASSWORD}});
    if (!login.ok()) {
        throw new Error('Login refused: ' + login.status());
    }
    const created = await (await context.request.post(URL_ + '/api/atelier/projets',
        {data: {name: 'Images des défis', level: 'petits'}})).json();
    const id = created.projet.id;
    let rev = created.projet.rev;
    const page = await context.newPage();
    try {
        for (const defi of defis) {
            if (!SCRIPTS[defi.id]) {
                throw new Error('No script for the challenge ' + defi.id);
            }
            const json = JSON.parse(JSON.stringify(start));
            const first = json[json.pages[0]];
            first[first.sprites[0]].scripts = [place(SCRIPTS[defi.id], 130)];
            const saved = await context.request.put(URL_ + '/api/atelier/projets/' + id,
                {data: {rev: rev, name: 'Images des défis', json: JSON.stringify(json)}});
            if (!saved.ok()) {
                throw new Error('Project refused: ' + saved.status());
            }
            rev = (await saved.json()).projet.rev;
            await page.goto(URL_ + '/atelier/petits/editor.html?pmd5=' + id + '&mode=edit');
            await page.waitForSelector('#scripts .watermark', {state: 'attached'});
            await page.waitForTimeout(3000);
            // Only the blocks: the shadow of the character and the scroll arrows are hidden
            const box = await page.evaluate(function () {
                const scripts = document.getElementById('scripts');
                Array.from(scripts.children).forEach(function (e) {
                    if (e.className) {
                        e.style.visibility = 'hidden';
                    }
                });
                let l = Infinity; let t = Infinity; let r = 0; let b = 0;
                scripts.querySelectorAll('.look > div, .look > div *').forEach(function (e) {
                    const q = e.getBoundingClientRect();
                    if (q.width && q.height) {
                        l = Math.min(l, q.left); t = Math.min(t, q.top);
                        r = Math.max(r, q.right); b = Math.max(b, q.bottom);
                    }
                });
                return {x: l - 12, y: t - 12, width: r - l + 24, height: b - t + 24};
            });
            await page.screenshot({path: path.join(OUT, defi.image), clip: box});
            console.log(defi.image, Math.round(box.width) + ' x ' + Math.round(box.height));
        }
    } finally {
        await context.request.delete(URL_ + '/api/atelier/projets/' + id);
        await browser.close();
    }
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
