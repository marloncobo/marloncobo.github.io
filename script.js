// [MODELO DE DATOS] Definición de constantes y variables de estado
const palos = ['Oros', 'Copas', 'Espadas', 'Bastos'];
let mazo = [];          // Array para almacenar la baraja completa
let pista = [];         // Array para las cartas de penalización
let mazoRobo = [];      // Array (Pila) para robar cartas
let posiciones = {};    // Objeto para rastrear la posición de cada caballo
let cartasVolteadas = 0; // Contador de penalizaciones activadas
let juegoTerminado = false; // Bandera de estado
let intervaloAuto = null;   // Variable para controlar la automatización

// INICIALIZACIÓN
function inicializarDatos() {
    detenerAutoPlay(); // [RESTRICCIÓN] Asegurar que no haya bucles corriendo

    // Reiniciar restricciones y estados
    posiciones = { 'Oros': 0, 'Copas': 0, 'Espadas': 0, 'Bastos': 0 };
    cartasVolteadas = 0;
    juegoTerminado = false;
    document.getElementById('btn-sacar').disabled = false;
    document.getElementById('log').innerHTML = "<em>Juego iniciado. ¡Saca una carta!</em><br>";

    // [ESTRUCTURA] Bucle anidado para generar la baraja
    let cartasPermitidas = [1, 2, 3, 4, 5, 6, 7, 10, 12];
    mazo = [];
    for (let palo of palos) {
        for (let num of cartasPermitidas) {
            mazo.push({ palo: palo, numero: num });
        }
    }

    // [ALGORITMO] Mezclar mazo (Fisher-Yates)
    for (let i = mazo.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mazo[i], mazo[j]] = [mazo[j], mazo[i]];
    }

    // [OPERADORES] Manipulación de Arrays (Splice)
    pista = mazo.splice(0, 7); // Toma las primeras 7 para la pista
    mazoRobo = mazo; // Quedan 29 para robar

    // Reiniciar visuales de cartas
    document.getElementById('mazo-visual').style.opacity = '1';
    const cartaActiva = document.getElementById('carta-activa');
    cartaActiva.className = "carta-grande carta-vacia";
    cartaActiva.innerHTML = "TU CARTA";
    cartaActiva.style.borderColor = "rgba(255,255,255,0.3)";
    cartaActiva.style.color = "rgba(255,255,255,0.5)";

    dibujarTablero();
}

// [LÓGICA] Función principal del turno
function jugarTurno() {
    if (juegoTerminado) return;

    const btn = document.getElementById('btn-sacar');
    btn.disabled = true;

    // [RESTRICCIÓN] Validar que el mazo no esté vacío
    if (mazoRobo.length === 0) {
        logear("El mazo se quedó sin cartas. Empate técnico.");
        juegoTerminado = true;
        detenerAutoPlay();
        return;
    }

    // 1. Sacar carta
    let cartaSacada = mazoRobo.pop();
    
    // Actualizar visuales
    if (mazoRobo.length === 0) document.getElementById('mazo-visual').style.opacity = '0.5';
    mostrarCartaGrande(cartaSacada);

    logear(`🎯 Salió el ${cartaSacada.numero} de ${cartaSacada.palo}. El caballo de ${cartaSacada.palo} avanza.`);

    // [OPERADOR] Aritmético: Incremento
    posiciones[cartaSacada.palo]++;
    actualizarUI();

    // [ESTRUCTURA] Condicional para verificar victoria
    if (posiciones[cartaSacada.palo] >= 7) {
        logear(`🏆 <strong>¡EL CABALLO DE ${cartaSacada.palo.toUpperCase()} HA GANADO LA CARRERA!</strong>`);
        juegoTerminado = true;
        detenerAutoPlay();
        return;
    }

    // 3. Comprobar pista con retraso para permitir animación
    setTimeout(() => {
        verificarPista(btn);
    }, 800);
}

function verificarPista(btn) {
    // [LÓGICA] Comprobar condición de penalización (el último caballo cruzó la línea)
    let posicionMinima = Math.min(...Object.values(posiciones));

    if (posicionMinima > cartasVolteadas) {
        let cartaPista = pista[cartasVolteadas];
        logear(`⚠️ ¡Todos pasaron la línea ${cartasVolteadas + 1}! Se voltea carta de pista: ${cartaPista.numero} de ${cartaPista.palo}.`);

        // Voltear carta (actualizar estado y UI)
        cartasVolteadas++;
        actualizarUI();

        logear(`🛑 El caballo de ${cartaPista.palo} retrocede un espacio.`);

        // Retraso para ver la carta antes de retroceder
        setTimeout(() => {
            // [OPERADOR] Decremento (Penalización)
            posiciones[cartaPista.palo]--;
            actualizarUI();
            if(!intervaloAuto) btn.disabled = false; // Solo reactivar botón si no es automático
        }, 1000);

    } else {
        // No se voltea carta, turno termina
        if(!intervaloAuto) btn.disabled = false;
    }
}

// [AUTOMATIZACIÓN] Función para simular la partida
function toggleAutoPlay() {
    const btnAuto = document.getElementById('btn-auto');
    if (intervaloAuto) {
        detenerAutoPlay();
    } else {
        if (juegoTerminado) reiniciarJuego();
        btnAuto.innerHTML = "⏸ Pausar Simulación";
        btnAuto.style.backgroundColor = "#e67e22";
        // Ejecuta un turno cada 2 segundos para dar tiempo a las animaciones
        intervaloAuto = setInterval(jugarTurno, 2000);
    }
}

function detenerAutoPlay() {
    clearInterval(intervaloAuto);
    intervaloAuto = null;
    const btnAuto = document.getElementById('btn-auto');
    if(btnAuto) {
        btnAuto.innerHTML = "▶ Simulación Automática";
        btnAuto.style.backgroundColor = "#3498db";
    }
}

// INTERFAZ DE USUARIO (Render)
function dibujarTablero() {
    const carrilesDiv = document.getElementById('carriles');
    carrilesDiv.innerHTML = '';

    palos.forEach((palo, index) => {
        let carril = `<div class="carril">
                <div class="nombre-palo" style="color: ${palo==='Oros'?'#f1c40f':(palo==='Copas'?'#e74c3c':(palo==='Espadas'?'#3498db':'#8e44ad'))}">${palo}</div>
                <div class="casillas">`;
        for(let i=0; i<=7; i++) {
            carril += `<div class="casilla"></div>`;
        }
        // La ficha (Caballo)
        carril += `<div class="caballo-ficha" id="ficha-${palo}" style="left: 0px;">🐎</div>
                </div></div>`;
        carrilesDiv.innerHTML += carril;
    });

    const pistaUI = document.getElementById('pista-ui');
    pistaUI.innerHTML = '';
    for(let i=0; i<7; i++) {
        pistaUI.innerHTML += `<div class="carta-pista" id="pista-${i}">?</div>`;
    }
    actualizarUI();
}

function actualizarUI() {
    // Actualizar caballos
    palos.forEach(palo => {
        const ficha = document.getElementById(`ficha-${palo}`);
        // Cada casilla mide 40px + 4px borde = 44px. Gap 5px. Total 49px.
        // +2px para centrar en el contenido (borde es 2px)
        ficha.style.left = ((posiciones[palo] * 49) + 2) + 'px';
    });

    // Actualizar pista
    for(let i=0; i<7; i++) {
        const cartaUI = document.getElementById(`pista-${i}`);
        if (i < cartasVolteadas) {
            cartaUI.className = "carta-pista volteada";
            cartaUI.innerHTML = `${pista[i].numero}<br>${pista[i].palo.substring(0,3)}`;
        } else {
            cartaUI.className = "carta-pista";
            cartaUI.innerHTML = "?";
        }
    }
}

function mostrarCartaGrande(carta) {
    const el = document.getElementById('carta-activa');
    el.className = "carta-grande";
    
    let color = '#333';
    if(carta.palo === 'Oros') color = '#f1c40f';
    else if(carta.palo === 'Copas') color = '#e74c3c';
    else if(carta.palo === 'Espadas') color = '#3498db';
    else if(carta.palo === 'Bastos') color = '#8e44ad';

    el.style.color = color;
    el.style.borderColor = color;
    el.innerHTML = `<span class="numero-carta">${carta.numero}</span><span class="palo-carta">${carta.palo}</span>`;
}

function logear(mensaje) {
    const logBox = document.getElementById('log');
    logBox.innerHTML = mensaje + "<br>" + logBox.innerHTML;
}

function reiniciarJuego() {
    inicializarDatos();
}

// Arrancar juego al cargar
window.onload = inicializarDatos;