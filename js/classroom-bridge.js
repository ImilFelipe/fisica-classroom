/**
 * classroom-bridge.js
 * Motor compartido para todas las actividades hijas (.html) de Física Classroom
 * Compatible 100% con el index Madre (Liceo Maximiliano Salas Marchan • Prof. Felipe Imilpán Molina).
 */
(function () {
  const cfg = Object.assign({
    labId: 'lab_generico',
    titulo: document.title || 'Guía de Laboratorio Digital',
    nivel: '1° Medio',
    storageKey: 'LAB_HIJA_DATA',
    espejosAumento: false
  }, window.LAB_CONFIG || {});

  const STORAGE_KEY = cfg.storageKey;
  const KEY_INICIO = STORAGE_KEY + '_INICIO_SESION';
  const KEY_SALIDAS = STORAGE_KEY + '_SALIDAS';
  const KEY_VERIF = STORAGE_KEY + '_VERIF';
  const KEY_TEAM_ID = STORAGE_KEY + '_TEAM_ID';

  let contadorSalidasPestana = 0;
  let fechaInicioSesion = '';
  let isWhitelistNavigation = false;
  let timer90Interval = null;
  let timerHeartbeatSync = null;
  let actividadCerrada = false;
  let bridgeInicializado = false;
  let sesionTeamId = '';
  let ultimoEstadoSerializado = '';
  let ultimaAlturaEnviada = 0;
  let restoreFocusHandler = null;
  let contextPadre = {
    curso: '',
    carpeta: 'General',
    codigoSala: '',
    student1: '',
    actividadId: cfg.labId,
    actividadTitulo: cfg.titulo,
    expiraMs: 0,
    soloLecturaDocente: false
  };

  function mostrarMensajeFeedback(msg) {
    const toast = document.getElementById('toastNotification');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function generarCodigoVerificacion() {
    let cod = '';
    try { cod = localStorage.getItem(KEY_VERIF) || ''; } catch (e) {}
    if (!cod) {
      const hex = () => Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0');
      cod = `MSM-${hex()}-${hex()}`;
      try { localStorage.setItem(KEY_VERIF, cod); } catch (e) {}
    }
    return cod;
  }

  function obtenerCampo(ids) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && (el.value || '').trim() !== '') return el.value.trim();
    }
    return '';
  }

  function obtenerTeamId() {
    if (sesionTeamId) return sesionTeamId;
    let tid = '';
    try { tid = localStorage.getItem(KEY_TEAM_ID) || ''; } catch (e) {}
    if (!tid) {
      const salaNorm = String(contextPadre.codigoSala || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const nombreRef = (obtenerCampo(['integrante1', 'student1']) || contextPadre.student1 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (salaNorm && nombreRef) {
        tid = `eq_${salaNorm}_${nombreRef}`;
      } else {
        tid = 'eq_' + Date.now().toString(36) + '_' + Math.floor(1000 + Math.random() * 9000);
      }
      try { localStorage.setItem(KEY_TEAM_ID, tid); } catch (e) {}
    }
    sesionTeamId = tid;
    return sesionTeamId;
  }

  function recogerRespuestas() {
    const data = {};
    document.querySelectorAll('.saveable').forEach(el => {
      if (el.type === 'radio') {
        if (el.checked) data[el.name] = el.value;
      } else if (el.type === 'checkbox') {
        data[el.id || el.name] = el.checked;
      } else if (el.id) {
        data[el.id] = el.value;
      }
    });
    return data;
  }

  function marcarEstiloLleno(el) {
    if (!el || el.type === 'radio' || el.type === 'checkbox') return;
    if ((el.value || '').trim() !== '') {
      el.classList.add('filled');
    } else {
      el.classList.remove('filled');
    }
  }

  function actualizarProgreso() {
    const elements = document.querySelectorAll('.saveable');
    const radioGroups = new Set();
    let totalFields = 0;
    let filledFields = 0;

    elements.forEach(el => {
      if (el.type === 'radio') {
        if (!radioGroups.has(el.name)) {
          radioGroups.add(el.name);
          totalFields++;
          if (document.querySelector(`input[name="${el.name}"]:checked`)) filledFields++;
        }
      } else if (el.type === 'checkbox') {
        totalFields++;
        if (el.checked) filledFields++;
      } else {
        totalFields++;
        if ((el.value || '').trim() !== '') filledFields++;
        marcarEstiloLleno(el);
      }
    });

    const pct = totalFields > 0 ? Math.min(100, Math.round((filledFields / totalFields) * 100)) : 0;
    const pctEl = document.getElementById('progressPercent');
    const barEl = document.getElementById('progressBar');
    if (pctEl) pctEl.textContent = pct + '%';
    if (barEl) barEl.style.width = pct + '%';
    if (window.parent && window.parent !== window && !contextPadre.soloLecturaDocente) {
      try {
        window.parent.postMessage({
          type: 'LAB_PROGRESS_TICK',
          progreso: pct,
          codigoSala: contextPadre.codigoSala,
          actividadTitulo: contextPadre.actividadTitulo,
          student1: obtenerCampo(['integrante1', 'student1']) || contextPadre.student1
        }, '*');
      } catch (e) {}
    }
    return pct;
  }

  function calculateRubricScores() {
    let total = 0;
    const boxes = document.querySelectorAll('.rubric-box');
    boxes.forEach((box, idx) => {
      let boxScore = 0;
      const radios = box.querySelectorAll('input[type="radio"]:checked');
      const criteriaCount = box.querySelectorAll('.rubric-item').length || 3;
      radios.forEach(r => {
        const val = parseInt(r.value, 10);
        if (!isNaN(val)) boxScore += val;
      });
      total += boxScore;
      const badge = box.querySelector('.rubric-score-badge') || document.getElementById('scoreBadge' + (idx + 1));
      if (badge) badge.textContent = `Puntaje: ${boxScore} / ${criteriaCount * 3} pts`;
    });

    const i1 = obtenerCampo(['integrante1', 'student1']) || 'Integrante 1';
    const i2 = obtenerCampo(['integrante2', 'student2']) || 'Integrante 2';
    const t1 = document.getElementById('titleEval1');
    const t2 = document.getElementById('titleEval2');
    if (t1) t1.textContent = `📝 Evaluación: ${i1} evalúa a ${i2}`;
    if (t2) t2.textContent = `📝 Evaluación: ${i2} evalúa a ${i1}`;
    return total;
  }

  function calcularAumento() {
    const display = document.getElementById('displayAumento');
    if (!display) return null;
    const doVal = parseFloat(obtenerCampo(['input_do', 'med_do']));
    const diVal = parseFloat(obtenerCampo(['input_di', 'med_di']));
    const hoVal = parseFloat(obtenerCampo(['input_ho', 'med_ho']));
    const hiVal = parseFloat(obtenerCampo(['input_hi', 'med_hi']));

    let ratioStr = '--';
    if (doVal > 0 && diVal > 0) {
      ratioStr = (diVal / doVal).toFixed(2);
      const ratioAlt = (hoVal > 0 && hiVal > 0) ? ` | hi/ho = ${(hiVal / hoVal).toFixed(2)}` : '';
      display.textContent = `Relación (di/do): ${ratioStr}${ratioAlt}`;
    } else {
      display.textContent = 'Relación (di/do): Ingrese mediciones...';
    }
    return {
      do: isNaN(doVal) ? 0 : doVal,
      di: isNaN(diVal) ? 0 : diVal,
      ho: isNaN(hoVal) ? 0 : hoVal,
      hi: isNaN(hiVal) ? 0 : hiVal,
      ratio: ratioStr === '--' ? 'N/A' : ratioStr
    };
  }

  function evaluarConceptosYCasos(resp) {
    let p1Score = 0;
    const p1Details = [];
    document.querySelectorAll('.fill-input[data-answer]').forEach((inp, idx) => {
      const esperadas = (inp.getAttribute('data-answer') || '').split(',').map(s => s.trim().toLowerCase());
      const val = (resp[inp.id] || '').trim().toLowerCase();
      const ok = val !== '' && esperadas.includes(val);
      if (ok) p1Score++;
      p1Details.push({ num: idx + 1, id: inp.id, ingresado: resp[inp.id] || '', esCorrecto: ok });
    });

    let p3Score = 0;
    const p3Details = [];
    document.querySelectorAll('select[data-correct]').forEach(sel => {
      const esp = sel.getAttribute('data-correct') || '';
      const val = resp[sel.id] || '';
      const ok = val !== '' && val.toLowerCase() === esp.toLowerCase();
      if (ok) p3Score++;
      p3Details.push({ clave: sel.id, ingresado: val, esCorrecto: ok, esperada: esp });
    });

    return {
      aciertosP1: { score: p1Score, total: p1Details.length, details: p1Details },
      aciertosP3: { score: p3Score, total: p3Details.length, details: p3Details }
    };
  }

  function construirPayloadCompleto() {
    const data = recogerRespuestas();
    const progreso = actualizarProgreso();
    const rubricas = calculateRubricScores();
    const aumento = calcularAumento();
    const evalAuto = evaluarConceptosYCasos(data);
    const codVerif = generarCodigoVerificacion();

    const s1 = obtenerCampo(['integrante1', 'student1']) || contextPadre.student1 || '';
    const s2 = obtenerCampo(['integrante2', 'student2']);
    const s3 = obtenerCampo(['integrante3', 'student3']);
    const cursoVal = contextPadre.curso || obtenerCampo(['cursoEstudiante', 'cursoGroup']) || '1° Medio A';

    return {
      teamId: obtenerTeamId(),
      labId: cfg.labId,
      actividadId: contextPadre.actividadId || cfg.labId,
      actividadTitulo: contextPadre.actividadTitulo || cfg.titulo,
      codigoSala: contextPadre.codigoSala || '',
      carpeta: contextPadre.carpeta || 'General',
      curso: cursoVal,
      // Campos compatibles con el index Madre nuevo (student1/2/3) y con la versión anterior (integrante1/2)
      student1: s1,
      student2: s2,
      student3: s3,
      integrante1: s1,
      correo1: (data.correo1 || '').trim(),
      integrante2: s2,
      correo2: (data.correo2 || '').trim(),
      integrante3: s3,
      correoSesion: (data.correoSesion || '').trim(),
      progreso: progreso,
      salidasDePestana: contadorSalidasPestana,
      codigoVerificacion: codVerif,
      fechaInicioSesion: fechaInicioSesion,
      ultimaActividad: new Date().toLocaleTimeString('es-CL'),
      timestamp: Date.now(),
      aciertosP1: evalAuto.aciertosP1,
      aciertosP3: evalAuto.aciertosP3,
      puntajeRubricas: rubricas,
      aumento: aumento,
      respuestas: data
    };
  }

  let bcChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bcChannel = new BroadcastChannel('FISICA_CLASSROOM_LIVE_SYNC');
    }
  } catch (e) {}

  let timerBridgeCloudRelay = null;
  function emitirBridgeCloudRelay(payload) {
    if (!payload || !payload.teamId || contextPadre.soloLecturaDocente) return;
    clearTimeout(timerBridgeCloudRelay);
    timerBridgeCloudRelay = setTimeout(() => {
      try {
        const respCompact = {};
        if (payload.respuestas && typeof payload.respuestas === 'object') {
          Object.keys(payload.respuestas).forEach(k => {
            if (k === '_meta') return;
            const v = payload.respuestas[k];
            if (v !== undefined && v !== null && String(v).trim() !== '') {
              respCompact[k] = String(v).slice(0, 300);
            }
          });
        }
        const compact = {
          teamId: payload.teamId,
          student1: payload.student1 || 'Estudiante 1',
          student2: payload.student2 || '',
          student3: payload.student3 || '',
          correo1: payload.correo1 || '',
          correo2: payload.correo2 || '',
          correoSesion: payload.correoSesion || '',
          curso: payload.curso || contextPadre.curso || '',
          carpeta: payload.carpeta || contextPadre.carpeta || 'General',
          codigoSala: payload.codigoSala || contextPadre.codigoSala || '',
          actividadId: payload.actividadId || cfg.labId,
          actividadTitulo: payload.actividadTitulo || cfg.titulo,
          progreso: Number(payload.progreso) || 0,
          salidasDePestana: Number(payload.salidasDePestana) || 0,
          codigoVerificacion: payload.codigoVerificacion || '',
          fechaInicioSesion: payload.fechaInicioSesion || '',
          ultimaActividad: payload.ultimaActividad || new Date().toLocaleTimeString('es-CL'),
          timestamp: payload.timestamp || Date.now(),
          aciertosP1: payload.aciertosP1 || null,
          aciertosP3: payload.aciertosP3 || null,
          puntajeRubricas: payload.puntajeRubricas || 0,
          aumento: payload.aumento || null,
          respuestas: respCompact
        };

        const limpio = String(compact.codigoSala || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const topicSala = limpio ? `msm_fisica_lmsm_2026_${limpio}` : 'msm_fisica_lmsm_2026_master';
        const bodyStr = JSON.stringify({ type: 'LAB_TEAM_UPDATE', payload: compact });

        fetch('https://ntfy.sh/' + topicSala, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: bodyStr
        }).catch(() => {});

        if (topicSala !== 'msm_fisica_lmsm_2026_master') {
          fetch('https://ntfy.sh/msm_fisica_lmsm_2026_master', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: bodyStr
          }).catch(() => {});
        }
      } catch (e) {}
    }, 1200);
  }

  function serializarFirmaEstado(payload) {
    if (!payload) return '';
    return JSON.stringify({
      respuestas: payload.respuestas || {},
      progreso: payload.progreso || 0,
      salidas: payload.salidasDePestana || 0,
      s1: payload.student1 || '',
      s2: payload.student2 || '',
      s3: payload.student3 || ''
    });
  }

  function notificarAlPadre(tipoEvento, extra = {}) {
    const payload = construirPayloadCompleto();
    ultimoEstadoSerializado = serializarFirmaEstado(payload);
    const msgObj = Object.assign({
      type: tipoEvento,
      labId: cfg.labId,
      soloLecturaDocente: contextPadre.soloLecturaDocente,
      payload: payload
    }, extra);

    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(msgObj, '*'); } catch (e) {}
      return;
    }
    if (bcChannel && !contextPadre.soloLecturaDocente) {
      try { bcChannel.postMessage(msgObj); } catch (e) {}
    }
    if (!contextPadre.soloLecturaDocente && payload && payload.teamId) {
      try {
        const rawMap = localStorage.getItem('LAB_FISICA_EQUIPOS_EN_VIVO') || '{}';
        const mapObj = JSON.parse(rawMap);
        mapObj[payload.teamId] = payload;
        localStorage.setItem('LAB_FISICA_EQUIPOS_EN_VIVO', JSON.stringify(mapObj));
      } catch (e) {}
      // Emitir también a Cloud Relay para sincronización multicuenta / multi-equipo
      emitirBridgeCloudRelay(payload);
    }
  }

  function guardarEnLocalStorage() {
    if (contextPadre.soloLecturaDocente) return;
    const data = recogerRespuestas();
    data._meta = {
      inicio: fechaInicioSesion,
      ultimaModif: new Date().toLocaleString('es-CL'),
      salidas: contadorSalidasPestana,
      codigoVerificacion: generarCodigoVerificacion()
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(KEY_SALIDAS, String(contadorSalidasPestana));
    } catch (e) {}

    const metaModif = document.getElementById('metaUltimaModif');
    if (metaModif) metaModif.textContent = data._meta.ultimaModif;

    const status = document.getElementById('saveStatus');
    if (status) {
      status.classList.add('visible');
      clearTimeout(status._timer);
      status._timer = setTimeout(() => status.classList.remove('visible'), 2500);
    }
    notificarAlPadre('LAB_STATE_UPDATE');
  }

  function cargarRespuestasGuardadas() {
    if (contextPadre.soloLecturaDocente) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      Object.keys(data).forEach(k => {
        if (k === '_meta') return;
        const el = document.getElementById(k);
        if (el && el.type === 'checkbox') {
          el.checked = Boolean(data[k]);
        } else if (el && el.type !== 'radio') {
          el.value = data[k];
          marcarEstiloLleno(el);
        } else {
          document.querySelectorAll(`input[name="${k}"]`).forEach(r => {
            const match = r.value === String(data[k]);
            r.checked = match;
            const lbl = r.closest('.rubric-label');
            if (lbl) lbl.classList.toggle('selected', match);
          });
        }
      });
      if (data._meta) {
        if (data._meta.inicio) fechaInicioSesion = data._meta.inicio;
        if (typeof data._meta.salidas === 'number') contadorSalidasPestana = data._meta.salidas;
      }
    } catch (e) {}
  }

  function actualizarSelloEvidenciaUI() {
    const cod = generarCodigoVerificacion();
    const badge = document.getElementById('codigoVerificacionBadge');
    const metaSello = document.getElementById('metaSelloIntegridad') || document.getElementById('metaHashResumen');
    const metaInicio = document.getElementById('metaInicioSesion');
    const metaSalidas = document.getElementById('metaSalidasPestana');

    if (badge) badge.textContent = 'ID: ' + cod;
    if (metaSello) metaSello.textContent = `Válido (${cod})`;
    if (metaInicio) metaInicio.textContent = fechaInicioSesion;
    if (metaSalidas) {
      if (contadorSalidasPestana === 0) {
        metaSalidas.textContent = '0 salidas (Sin alertas)';
        metaSalidas.style.color = '#16a34a';
      } else {
        metaSalidas.textContent = `${contadorSalidasPestana} advertencia(s) de salida`;
        metaSalidas.style.color = '#dc2626';
      }
    }
  }

  function aplicarContextoCursoYActividad(info) {
    if (!info) return;
    if (info.curso) contextPadre.curso = info.curso;
    if (info.carpeta) contextPadre.carpeta = info.carpeta;
    if (info.codigoSala || info.codigoClase || info.clase) {
      contextPadre.codigoSala = String(info.codigoSala || info.codigoClase || info.clase).toUpperCase();
    }
    if (info.student1) contextPadre.student1 = info.student1;
    if (info.actividadId) contextPadre.actividadId = info.actividadId;
    if (info.actividadTitulo) contextPadre.actividadTitulo = info.actividadTitulo;
    if (info.expiraMs) contextPadre.expiraMs = Number(info.expiraMs);
    if (info.soloLecturaDocente) contextPadre.soloLecturaDocente = true;

    const selCurso = document.getElementById('cursoEstudiante') || document.getElementById('cursoGroup');
    if (selCurso && contextPadre.curso) {
      if (selCurso.tagName === 'SELECT') {
        const existe = Array.from(selCurso.options).some(o => o.value === contextPadre.curso || o.value.startsWith(contextPadre.curso));
        if (!existe) {
          const opt = document.createElement('option');
          opt.value = contextPadre.curso;
          opt.textContent = '📁 ' + contextPadre.curso;
          selCurso.appendChild(opt);
        }
        const matchOpt = Array.from(selCurso.options).find(o => o.value === contextPadre.curso || o.value.startsWith(contextPadre.curso));
        if (matchOpt) selCurso.value = matchOpt.value;
      } else {
        selCurso.value = contextPadre.curso;
      }
      if (window.parent && window.parent !== window && !contextPadre.soloLecturaDocente) {
        selCurso.disabled = true;
      }
    }

    const inpS1 = document.getElementById('integrante1') || document.getElementById('student1');
    if (inpS1 && contextPadre.student1 && !inpS1.value.trim()) {
      inpS1.value = contextPadre.student1;
      marcarEstiloLleno(inpS1);
    }

    const titleEl = document.getElementById('studentActiveLessonTitle');
    if (titleEl && contextPadre.actividadTitulo) {
      titleEl.textContent = contextPadre.actividadTitulo;
    }

    const badgeCod = document.getElementById('badgeCodigoClaseAlumno');
    if (badgeCod && contextPadre.codigoSala) {
      badgeCod.textContent = `🔑 Clase: ${contextPadre.codigoSala}`;
    }

    if (contextPadre.expiraMs > Date.now()) {
      iniciarTemporizador90(contextPadre.expiraMs);
    }
  }

  function iniciarTemporizador90(expiraMs) {
    clearInterval(timer90Interval);
    const badge = document.getElementById('studentTimer90Badge');
    if (!badge) return;
    const tick = () => {
      const rest = Math.max(0, expiraMs - Date.now());
      const mins = Math.floor(rest / 60000);
      const secs = Math.floor((rest % 60000) / 1000);
      badge.textContent = `⏱️ ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} min`;
      if (rest <= 0) {
        clearInterval(timer90Interval);
        cerrarActividadHija('Se cumplió el tiempo reglamentario de 90 minutos.');
      }
    };
    tick();
    timer90Interval = setInterval(tick, 1000);
  }

  function cerrarActividadHija(motivo) {
    if (actividadCerrada) return;
    actividadCerrada = true;
    document.querySelectorAll('.saveable').forEach(el => { el.disabled = true; });
    mostrarMensajeFeedback('🔒 ' + (motivo || 'Actividad finalizada por el profesor.'));
  }

  function ajustarAlturaAlPadre() {
    if (window.parent && window.parent !== window) {
      try {
        const cont = document.querySelector('.container');
        const h = cont ? Math.ceil(cont.offsetHeight + 48) : document.body.scrollHeight;
        if (Math.abs(h - ultimaAlturaEnviada) > 8) {
          ultimaAlturaEnviada = h;
          window.parent.postMessage({
            type: 'LAB_RESIZE',
            height: h
          }, '*');
        }
      } catch (e) {}
    }
  }

  // Exponer funciones globales usadas por el HTML de las actividades
  window.imprimirLaboratorio = function () {
    guardarEnLocalStorage();
    window.print();
  };

  window.finalizarYGenerarReporte = function () {
    guardarEnLocalStorage();
    notificarAlPadre('LAB_SUBMITTED');
    mostrarMensajeFeedback('📄 Preparando informe oficial para PDF...');
    setTimeout(() => window.print(), 250);
  };

  window.guardarManual = function () {
    guardarEnLocalStorage();
    mostrarMensajeFeedback('💾 Avance guardado y sincronizado.');
  };

  window.descargarAvance = function () {
    const payload = construirPayloadCompleto();
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const nombreBase = (payload.student1 || 'Equipo_Lab').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `Avance_${cfg.labId}_${nombreBase}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    mostrarMensajeFeedback('📥 Archivo de respaldo (.json) descargado.');
  };

  window.abrirSelectorArchivo = function () {
    const inp = document.getElementById('fileImportInput');
    if (inp) inp.click();
  };

  window.cargarArchivoAvance = function (event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const parsed = JSON.parse(String(ev.target.result || '{}'));
        const resp = parsed.respuestas || parsed;
        Object.keys(resp).forEach(k => {
          if (k === '_meta') return;
          const el = document.getElementById(k);
          if (el && el.type !== 'radio' && el.type !== 'checkbox') {
            el.value = resp[k];
          } else {
            document.querySelectorAll(`input[name="${k}"]`).forEach(r => {
              const match = r.value === String(resp[k]);
              r.checked = match;
              const lbl = r.closest('.rubric-label');
              if (lbl) lbl.classList.toggle('selected', match);
            });
          }
        });
        actualizarProgreso();
        calcularAumento();
        calculateRubricScores();
        guardarEnLocalStorage();
        mostrarMensajeFeedback('✓ Archivo cargado y sincronizado.');
      } catch (err) {
        alert('El archivo seleccionado no tiene un formato .json válido.');
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  window.reiniciarGuia = function () {
    if (!confirm('¿Estás seguro de borrar tus respuestas locales en esta guía?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    document.querySelectorAll('.saveable').forEach(el => {
      if (el.id === 'input_do') return;
      if (el.type === 'radio' || el.type === 'checkbox') {
        el.checked = false;
        const lbl = el.closest('.rubric-label');
        if (lbl) lbl.classList.remove('selected');
      } else if (el.tagName === 'SELECT') {
        if (el.id !== 'cursoEstudiante') el.selectedIndex = 0;
      } else {
        el.value = '';
      }
    });
    actualizarProgreso();
    calcularAumento();
    calculateRubricScores();
    guardarEnLocalStorage();
    mostrarMensajeFeedback('🔄 Guía reiniciada.');
  };

  window.abrirModalAuthDocente = function () {
    if (window.parent && window.parent !== window) {
      notificarAlPadre('OPEN_TEACHER_PANEL');
    } else {
      alert('Para abrir el Panel Docente, abre la plataforma madre (index.html).');
    }
  };

  window.bloquearLaboratorio = function () {
    if (window.parent && window.parent !== window) {
      notificarAlPadre('LOCK_SESSION');
    } else {
      mostrarMensajeFeedback('🔒 Modo independiente: abre desde la plataforma madre para bloquear por código.');
    }
  };

  window.cambiarCursoEstudiante = function () {
    const sel = document.getElementById('cursoEstudiante');
    if (sel) contextPadre.curso = sel.value;
    guardarEnLocalStorage();
  };

  window.iniciarSesionConGoogle = function () {
    const inp = document.getElementById('correoSesion');
    const correo = prompt('Ingresa el correo de tu cuenta institucional o Google activa:', inp ? inp.value : '');
    if (correo && correo.trim()) {
      if (inp) inp.value = correo.trim();
      actualizarProgreso();
      guardarEnLocalStorage();
      mostrarMensajeFeedback('✓ Correo de sesión registrado.');
    }
  };

  window.toggleSimuladorIntegrado = function () {
    const cont = document.getElementById('phetIframeContainer');
    if (!cont) return;
    cont.style.display = cont.style.display === 'none' ? 'block' : 'none';
    setTimeout(ajustarAlturaAlPadre, 100);
  };

  window.abrirSitioAutorizado = function (url, nombreSitio) {
    isWhitelistNavigation = true;
    if (nombreSitio) {
      mostrarMensajeFeedback(`🛡️ Abriendo sitio autorizado en Lista Blanca: ${nombreSitio} (Sin alerta de salida)`);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    // Mantener la exención activa mientras el estudiante consulta el recurso de lista blanca y vuelve a la guía
    if (restoreFocusHandler) {
      window.removeEventListener('focus', restoreFocusHandler);
    }
    restoreFocusHandler = () => {
      setTimeout(() => { isWhitelistNavigation = false; }, 1200);
      window.removeEventListener('focus', restoreFocusHandler);
      restoreFocusHandler = null;
    };
    window.addEventListener('focus', restoreFocusHandler);
  };

  window.calcularAumento = calcularAumento;

  window.updateRadioClass = function (labelEl, event) {
    if (!labelEl) return;
    if (event && event.type === 'click' && event.target && event.target.tagName !== 'INPUT') {
      event.preventDefault();
    }
    const container = labelEl.closest('.rubric-options');
    if (container) {
      container.querySelectorAll('.rubric-label').forEach(l => l.classList.remove('selected'));
    }
    labelEl.classList.add('selected');
    const inp = labelEl.querySelector('input[type="radio"]');
    if (inp && !inp.checked) inp.checked = true;
    calculateRubricScores();
    actualizarProgreso();
    guardarEnLocalStorage();
  };

  function onDocumentInput(e) {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains('saveable')) return;
    if (el.type === 'radio' || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    actualizarProgreso();
    calcularAumento();
    guardarEnLocalStorage();
  }

  function onDocumentChange(e) {
    const el = e.target;
    if (!el || !el.classList || !el.classList.contains('saveable')) return;
    actualizarProgreso();
    calculateRubricScores();
    calcularAumento();
    guardarEnLocalStorage();
  }

  function onVisibilityChange() {
    if (document.hidden && !isWhitelistNavigation && !actividadCerrada && !contextPadre.soloLecturaDocente) {
      contadorSalidasPestana++;
      actualizarSelloEvidenciaUI();
      guardarEnLocalStorage();
    }
  }

  function onContextMenu(e) {
    if (contextPadre.soloLecturaDocente) return;
    e.preventDefault();
    mostrarMensajeFeedback('🔒 Menú contextual (clic derecho) desactivado por protocolo de integridad académica.');
  }

  function onCopy(e) {
    if (contextPadre.soloLecturaDocente) return;
    e.preventDefault();
    mostrarMensajeFeedback('🔒 Función de copiar texto desactivada para evitar consultas externas a IA.');
  }

  function onCut(e) {
    if (contextPadre.soloLecturaDocente) return;
    e.preventDefault();
  }

  function onPaste(e) {
    if (contextPadre.soloLecturaDocente) return;
    e.preventDefault();
    mostrarMensajeFeedback('🔒 Pegado bloqueado: debes redactar tus respuestas directamente con tu equipo.');
  }

  function onKeyDown(e) {
    if (contextPadre.soloLecturaDocente) return;
    const key = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'v' || key === 'x' || key === 'u')) {
      e.preventDefault();
      mostrarMensajeFeedback('🔒 Atajo de copiar/pegar desactivado durante el laboratorio.');
    } else if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (key === 'i' || key === 'j' || key === 'c'))) {
      e.preventDefault();
    }
  }

  function limpiarRecursosBridge() {
    clearInterval(timer90Interval);
    timer90Interval = null;
    clearInterval(timerHeartbeatSync);
    timerHeartbeatSync = null;
    clearTimeout(timerBridgeCloudRelay);
    timerBridgeCloudRelay = null;
    if (bcChannel) {
      try { bcChannel.close(); } catch (e) {}
      bcChannel = null;
    }
    window.removeEventListener('message', onParentMessage);
    if (restoreFocusHandler) {
      window.removeEventListener('focus', restoreFocusHandler);
      restoreFocusHandler = null;
    }
    document.removeEventListener('input', onDocumentInput);
    document.removeEventListener('change', onDocumentChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('keydown', onKeyDown);
  }

  // Escuchar comandos desde el index madre
  function onParentMessage(event) {
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'PARENT_INIT_SESSION') {
      aplicarContextoCursoYActividad(msg);
      actualizarProgreso();
      calculateRubricScores();
      notificarAlPadre('LAB_STATE_UPDATE');
    } else if (msg.type === 'PARENT_REQUEST_STATE') {
      notificarAlPadre('LAB_STATE_UPDATE');
    } else if (msg.type === 'PARENT_LOCK_ACTIVITY') {
      cerrarActividadHija(msg.motivo);
    } else if (msg.type === 'PARENT_CLEANUP') {
      limpiarRecursosBridge();
    }
  }
  window.addEventListener('message', onParentMessage);

  function iniciarBridgeLaboratorio() {
    if (bridgeInicializado) return;
    bridgeInicializado = true;

    try {
      fechaInicioSesion = localStorage.getItem(KEY_INICIO) || new Date().toLocaleString('es-CL');
      localStorage.setItem(KEY_INICIO, fechaInicioSesion);
      contadorSalidasPestana = parseInt(localStorage.getItem(KEY_SALIDAS) || '0', 10) || 0;
    } catch (e) {
      fechaInicioSesion = new Date().toLocaleString('es-CL');
    }

    const params = new URLSearchParams(window.location.search);
    const initCtx = window.CLASSROOM_PARENT_INIT || {};
    aplicarContextoCursoYActividad({
      curso: initCtx.curso || params.get('curso') || '',
      carpeta: initCtx.carpeta || params.get('carpeta') || 'General',
      codigoSala: initCtx.codigoSala || params.get('sala') || params.get('clase') || params.get('code') || '',
      student1: initCtx.student1 || params.get('student1') || '',
      actividadId: initCtx.actividadId || params.get('actividadId') || cfg.labId,
      actividadTitulo: initCtx.actividadTitulo || params.get('titulo') || cfg.titulo,
      expiraMs: parseInt(params.get('exp') || '0', 10) || 0,
      soloLecturaDocente: initCtx.soloLecturaDocente != null ? !!initCtx.soloLecturaDocente : (params.get('preview') === '1')
    });

    cargarRespuestasGuardadas();
    actualizarSelloEvidenciaUI();
    actualizarProgreso();
    calcularAumento();
    calculateRubricScores();

    document.addEventListener('input', onDocumentInput);
    document.addEventListener('change', onDocumentChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Protección Anti-IA y Anti-Copia: Bloquear clic derecho (menú contextual), copiar enunciados y pegar respuestas externas
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKeyDown);

    window.addEventListener('pagehide', limpiarRecursosBridge, { once: true });

    if (window.parent && window.parent !== window) {
      const topBar = document.getElementById('topBar');
      if (topBar) {
        if (contextPadre.soloLecturaDocente) {
          topBar.style.display = 'none';
        } else {
          const btnTeacher = topBar.querySelector('.btn-teacher');
          if (btnTeacher) btnTeacher.style.display = 'none';
        }
      }
      notificarAlPadre('LAB_READY');
      ajustarAlturaAlPadre();
      setTimeout(ajustarAlturaAlPadre, 600);
      clearInterval(timerHeartbeatSync);
      timerHeartbeatSync = setInterval(() => {
        const actual = construirPayloadCompleto();
        const firma = serializarFirmaEstado(actual);
        if (firma !== ultimoEstadoSerializado) {
          notificarAlPadre('LAB_STATE_UPDATE');
        }
      }, 6000);
    }
  }

  if (document.readyState !== 'loading') {
    iniciarBridgeLaboratorio();
  } else {
    document.addEventListener('DOMContentLoaded', iniciarBridgeLaboratorio, { once: true });
  }
})();
