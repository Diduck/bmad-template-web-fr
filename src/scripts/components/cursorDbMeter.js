/**
 * VU-mètre au curseur — calibration du seuil Auto-Cut.
 *
 * Tant que le collapse "Options Auto-Cuts" (page Montage) est ouvert, échantillonne
 * le niveau audio (dB) à la position du curseur (CTI) de la séquence active. On lit
 * le WAV exporté (mix exact que mesure l'analyseur) s'il existe, sinon le média
 * source du clip audible sous le curseur — SANS analyse préalable. L'utilisateur
 * place le curseur sur une zone vide pour lire le bruit de fond et en déduire la
 * "Limite" à saisir.
 *
 * Mesure : ffmpeg `volumedetect` (mean_volume, dBFS). L'exécution passe par le JSX
 * (RunDbProbe → pattern vbs `sh.Run` caché, éprouvé dans l'extension) qui redirige
 * la sortie vers un .txt temporaire ; ce module le lit via window.cep.fs.
 * → Aucune dépendance Node (require/cep_node ne sont PAS exposés dans les modules
 *   ES avec ce manifest CEP ; seul window.cep.{fs,process} l'est).
 * ffmpeg n'est relancé que lorsque le curseur a bougé (pas de spam de process).
 */

const POLL_MS = 600;          // fréquence de lecture de la position curseur
const WINDOW_SEC = 0.4;       // fenêtre de mesure (s) autour du curseur
const MOVE_EPS = 0.03;        // déplacement curseur (s) requis pour re-mesurer
const SUGGEST_MARGIN_DB = 4;  // marge ajoutée au mean pour suggérer la Limite
const PROBE_POLL_MS = 150;    // intervalle de polling du fichier résultat
const PROBE_MAX_TRIES = 40;   // ~6 s max d'attente d'une mesure

const RMS_RE = /mean_volume:\s*(-?inf|-?[0-9.]+) dB/;

export function initCursorDbMeter(csInterface /*, extensionRoot (ffmpeg résolu côté JSX) */) {
    const valueEl = document.getElementById('cursorDbValue');
    const meterEl = document.getElementById('cursorDbMeter');
    // Pas sur la page Montage (markup absent) → no-op
    if (!valueEl || !meterEl) return;

    const collapsBlock = document.querySelector('.OptionCutCollaps');
    const content = collapsBlock ? collapsBlock.querySelector('.content') : null;
    if (!content) return;

    const ORIG_TITLE = meterEl.getAttribute('title') || '';

    let pollTimer = null;
    let lastPlayhead = null;
    let inFlight = false;

    function setReadout(text, off) {
        valueEl.textContent = text;
        meterEl.className = 'cursor-db' + (off ? ' cursor-db--off' : '');
    }

    function evalAsync(fnCall) {
        return new Promise((resolve) => {
            csInterface.evalScript(fnCall, (r) => resolve(r));
        });
    }

    function readCepFile(p) {
        try {
            const r = window.cep.fs.readFile(p);
            if (r && r.err === 0 && typeof r.data === 'string') return r.data;
        } catch (e) {}
        return null;
    }

    function showResult(text) {
        meterEl.className = 'cursor-db';
        meterEl.title = ORIG_TITLE;
        valueEl.textContent = text;
    }

    function applyMatch(m) {
        if (/inf/i.test(m[1])) {
            showResult('−∞ dB');               // silence numérique total
            meterEl.dataset.suggest = '-70';
            return;
        }
        const mean = parseFloat(m[1]);
        showResult(mean.toFixed(1) + ' dB');
        meterEl.dataset.suggest = String(Math.round((mean + SUGGEST_MARGIN_DB) * 10) / 10);
    }

    function pollResult(outTxt, tries) {
        const out = readCepFile(outTxt);
        const m = out && RMS_RE.exec(out);
        if (m) { inFlight = false; applyMatch(m); return; }
        if (tries >= PROBE_MAX_TRIES) { inFlight = false; setReadout('—', true); return; }
        setTimeout(() => pollResult(outTxt, tries + 1), PROBE_POLL_MS);
    }

    function measure(probePath, probeTime) {
        inFlight = true;
        const start = Math.max(0, probeTime - WINDOW_SEC / 2);
        const safe = String(probePath).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const call = 'RunDbProbe("' + safe + '", ' + start.toFixed(3) + ', ' + WINDOW_SEC.toFixed(3) + ')';
        evalAsync(call).then((raw) => {
            let r;
            try { r = JSON.parse(raw); } catch (e) { r = null; }
            if (!r || !r.ok || !r.outTxt) { inFlight = false; setReadout('—', true); return; }
            pollResult(r.outTxt, 0);
        });
    }

    async function tick() {
        let info;
        try { info = JSON.parse(await evalAsync('GetPlayheadProbeInfo()')); }
        catch (e) { return; }
        if (!info || !info.ok) { setReadout('—', true); return; }

        // Source à sonder : WAV exporté (mix exact) si présent, sinon média source
        // du clip audible sous le curseur (résolu à travers les sous-séquences).
        let probePath = null, probeTime = null;
        if (info.wavPath && info.wavExists) {
            probePath = info.wavPath;
            probeTime = info.playhead;
        } else if (info.hasClip && info.mediaPath) {
            probePath = info.mediaPath;
            probeTime = info.sourceTime;
        }

        if (!probePath) {
            setReadout('— (pas de clip)', true);
            if (info.reason) {
                meterEl.title = 'Aucun média sondable : ' + info.reason;
                try { console.debug('[cursorDbMeter]', info.reason); } catch (e) {}
            }
            lastPlayhead = null;
            return;
        }

        if (inFlight) return;                       // une mesure est déjà en cours
        // Ne relance ffmpeg que si le curseur a bougé
        if (lastPlayhead !== null && Math.abs(info.playhead - lastPlayhead) < MOVE_EPS) return;
        lastPlayhead = info.playhead;
        measure(probePath, probeTime);
    }

    function start() {
        if (pollTimer) return;
        setReadout('…', false);
        lastPlayhead = null;
        tick();
        pollTimer = setInterval(tick, POLL_MS);
    }
    function stop() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    const isVisible = () => content.style.display && content.style.display !== 'none';

    const observer = new MutationObserver(() => { isVisible() ? start() : stop(); });
    observer.observe(content, { attributes: true, attributeFilter: ['style'] });
    if (isVisible()) start();

    // Clic sur le mètre → pré-remplit "Limite" avec le seuil suggéré (mean + marge)
    meterEl.addEventListener('click', () => {
        const suggest = meterEl.dataset.suggest;
        const limite = document.getElementById('LimiteCuts');
        if (suggest && limite) {
            limite.value = suggest;
            limite.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });
}

export default initCursorDbMeter;
