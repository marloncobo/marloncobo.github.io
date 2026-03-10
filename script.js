// URL de tu servidor en Railway (SIN la barra al final)
// Ejemplo: const BACKEND_URL = 'https://carreras-caballo-production.up.railway.app';
const BACKEND_URL = 'mysql://root:vFKYHQIyVEiwxdduXWlUBLadKtmNJASl@switchyard.proxy.rlwy.net:35127/railway';

const socket = io(BACKEND_URL); // Conectar al servidor WebSocket remoto

/* --- GESTIÓN DE LA APLICACIÓN (USUARIOS Y VISTAS) --- */
const app = {
    usuarioActual: null,
    apuestas: [], // { nombre: "Juan", caballo: "Oros", cantidad: 100 }

    init: function() {
        // Verificar si hay sesión guardada (solo para mantener la vista, los datos reales vienen del servidor)
        const usuarioGuardado = localStorage.getItem('usuarioActual');
        if (usuarioGuardado) {
            this.usuarioActual = JSON.parse(usuarioGuardado);
            this.mostrarVista('vista-lobby');
            this.actualizarInfoUsuario();
            socket.emit('usuarioConectado', this.usuarioActual);
        } else {
            this.mostrarVista('vista-login');
        }
    },

    mostrarVista: function(idVista) {
        document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
        document.getElementById(idVista).classList.add('activa');
    },

    registrarUsuario: async function() {
        const nombre = document.getElementById('input-usuario').value.trim();
        if (!nombre) return this.mostrarError("Ingresa un nombre válido.");

        try {
            const response = await fetch(`${BACKEND_URL}/api/registrar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Error al registrar usuario.');
            }

            const nuevoUsuario = await response.json();
            this.iniciarSesion(nuevoUsuario.nombre);

        } catch (error) {
            this.mostrarError(error.message);
        }
    },

    iniciarSesion: async function(nombreInput = null) {
        const nombre = nombreInput || document.getElementById('input-usuario').value.trim();
        if (!nombre) return this.mostrarError("Ingresa un nombre.");

        try {
            const response = await fetch(`${BACKEND_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Usuario no encontrado.');
            }

            this.usuarioActual = await response.json();
            localStorage.setItem('usuarioActual', JSON.stringify(this.usuarioActual));
            
            this.mostrarVista('vista-lobby');
            this.actualizarInfoUsuario();
            socket.emit('usuarioConectado', this.usuarioActual);

        } catch (error) {
            this.mostrarError(error.message);
        }
    },

    cerrarSesion: function() {
        localStorage.removeItem('usuarioActual');
        this.usuarioActual = null;
        this.mostrarVista('vista-login');
    },

    actualizarInfoUsuario: function() {
        if (!this.usuarioActual) return;
        document.getElementById('lobby-usuario').innerText = this.usuarioActual.nombre;
        document.getElementById('lobby-puntos').innerText = this.usuarioActual.puntos;
    },

    mostrarError: function(msg) {
        document.getElementById('mensaje-login').innerText = msg;
        setTimeout(() => document.getElementById('mensaje-login').innerText = "", 3000);
    },

    /* --- GESTIÓN DE APUESTAS --- */
    agregarApuesta: function() {
        if (this.apuestas.length >= 4) return alert("Máximo 4 jugadores por carrera.");

        const nombre = document.getElementById('apuesta-nombre').value.trim();
        const caballo = document.getElementById('apuesta-caballo').value;
        const cantidad = parseInt(document.getElementById('apuesta-cantidad').value);

        if (!nombre) return alert("Ingresa el nombre del jugador.");
        if (!cantidad || cantidad < 100) return alert("La apuesta mínima es de 100 puntos.");
        if (cantidad > this.usuarioActual.puntos) return alert("No tienes suficientes puntos.");

        // Enviar apuesta al servidor
        socket.emit('realizarApuesta', { nombre, caballo, cantidad });
        
        // Limpiar campos
        document.getElementById('apuesta-nombre').value = "";
        document.getElementById('apuesta-cantidad').value = "";
    },

    renderizarListaApuestas: function(apuestas) {
        const lista = document.getElementById('lista-apuestas');
        lista.innerHTML = "";
        apuestas.forEach((apuesta, index) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span><strong>${apuesta.nombre}</strong> apuesta ${apuesta.cantidad} a ${apuesta.caballo}</span>
            `;
            lista.appendChild(li);
        });

        document.getElementById('btn-iniciar-carrera').disabled = apuestas.length === 0;
    },

    irALaCarrera: function() {
        if (this.apuestas.length === 0) return;
        socket.emit('iniciarCarrera');
    },

    volverAlLobby: function() {
        document.getElementById('modal-resultados').style.display = "none";
        this.mostrarVista('vista-lobby');
    },

    /* --- TIENDA DE PUNTOS --- */
    comprarPuntos: async function(cantidad) {
        if (confirm(`¿Deseas comprar ${cantidad} puntos?`)) {
            try {
                const response = await fetch(`${BACKEND_URL}/api/comprar-puntos`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: this.usuarioActual.nombre, cantidad })
                });

                if (!response.ok) throw new Error('Error al comprar puntos.');

                const usuarioActualizado = await response.json();
                this.usuarioActual = usuarioActualizado;
                this.actualizarInfoUsuario();
                alert(`¡Has comprado ${cantidad} puntos!`);

            } catch (error) {
                alert(error.message);
            }
        }
    },

    procesarResultados: function(ganador) {
        const modal = document.getElementById('modal-resultados');
        const lista = document.getElementById('lista-ganancias');
        const titulo = document.getElementById('titulo-ganador');
        
        titulo.innerHTML = `🏆 ¡Gana ${ganador}!`;
        lista.innerHTML = "";

        this.apuestas.forEach(apuesta => {
            const div = document.createElement('div');
            if (apuesta.caballo === ganador) {
                const ganancia = apuesta.cantidad * 5;
                div.className = "ganador";
                div.innerHTML = `🎉 <strong>${apuesta.nombre}</strong> ganó ${ganancia} puntos!`;
            } else {
                div.className = "perdedor";
                div.innerHTML = `❌ <strong>${apuesta.nombre}</strong> perdió ${apuesta.cantidad} puntos.`;
            }
            lista.appendChild(div);
        });

        modal.style.display = "block";
    }
};

/* --- LÓGICA DEL JUEGO (CLIENTE) --- */
const juego = {
    palos: ['Oros', 'Copas', 'Espadas', 'Bastos'],
    posiciones: {},
    cartasVolteadas: 0,
    pista: [],

    inicializarDatos: function(estado) {
        this.posiciones = estado.posiciones;
        this.cartasVolteadas = estado.cartasVolteadas;
        this.pista = estado.pista;
        
        document.getElementById('btn-sacar').disabled = false;
        document.getElementById('log').innerHTML = "<em>Carrera iniciada. ¡Buena suerte!</em><br>";

        // Reset UI
        document.getElementById('mazo-visual').style.opacity = '1';
        const cartaActiva = document.getElementById('carta-activa');
        cartaActiva.className = "carta-grande carta-vacia";
        cartaActiva.innerHTML = "TU CARTA";
        cartaActiva.style.borderColor = "rgba(255,255,255,0.3)";
        cartaActiva.style.color = "rgba(255,255,255,0.5)";

        this.dibujarTablero();
    },

    jugarTurno: function() {
        socket.emit('sacarCarta');
    },

    dibujarTablero: function() {
        const carrilesDiv = document.getElementById('carriles');
        carrilesDiv.innerHTML = '';

        this.palos.forEach((palo) => {
            let carril = `<div class="carril">
                    <div class="nombre-palo" style="color: ${this.getColorPalo(palo)}">${palo}</div>
                    <div class="casillas">`;
            for(let i=0; i<=7; i++) {
                carril += `<div class="casilla"></div>`;
            }
            carril += `<div class="caballo-ficha" id="ficha-${palo}" style="left: 0px;">🐎</div>
                    </div></div>`;
            carrilesDiv.innerHTML += carril;
        });

        const pistaUI = document.getElementById('pista-ui');
        pistaUI.innerHTML = '';
        for(let i=0; i<7; i++) {
            pistaUI.innerHTML += `<div class="carta-pista" id="pista-${i}">?</div>`;
        }
        this.actualizarUI();
    },

    actualizarUI: function() {
        this.palos.forEach(palo => {
            const ficha = document.getElementById(`ficha-${palo}`);
            if (ficha) {
                ficha.style.left = ((this.posiciones[palo] * 49) + 2) + 'px';
            }
        });

        for(let i=0; i<7; i++) {
            const cartaUI = document.getElementById(`pista-${i}`);
            if (i < this.cartasVolteadas) {
                cartaUI.className = "carta-pista volteada";
                cartaUI.innerHTML = `${this.pista[i].numero}<br>${this.pista[i].palo.substring(0,3)}`;
            } else {
                cartaUI.className = "carta-pista";
                cartaUI.innerHTML = "?";
            }
        }
    },

    mostrarCartaGrande: function(carta) {
        const el = document.getElementById('carta-activa');
        el.className = "carta-grande";
        let color = this.getColorPalo(carta.palo);
        el.style.color = color;
        el.style.borderColor = color;
        el.innerHTML = `<span class="numero-carta">${carta.numero}</span><span class="palo-carta">${carta.palo}</span>`;
    },

    getColorPalo: function(palo) {
        if(palo === 'Oros') return '#f1c40f';
        if(palo === 'Copas') return '#e74c3c';
        if(palo === 'Espadas') return '#3498db';
        return '#8e44ad';
    },

    logear: function(mensaje) {
        const logBox = document.getElementById('log');
        logBox.innerHTML = mensaje + "<br>" + logBox.innerHTML;
    }
};

// --- EVENTOS SOCKET.IO ---
socket.on('actualizarApuestas', (apuestas) => {
    app.apuestas = apuestas;
    app.renderizarListaApuestas(apuestas);
});

socket.on('inicioCarrera', (estado) => {
    app.mostrarVista('vista-juego');
    juego.inicializarDatos(estado);
});

socket.on('cartaSacada', (data) => {
    juego.mostrarCartaGrande(data.carta);
    juego.logear(`🎯 Salió el ${data.carta.numero} de ${data.carta.palo}.`);
    juego.posiciones = data.posiciones;
    juego.actualizarUI();
});

socket.on('cartaPistaVolteada', (data) => {
    juego.logear(`⚠️ ¡Todos pasaron! Se voltea: ${data.carta.numero} de ${data.carta.palo}.`);
    juego.cartasVolteadas = data.indice + 1;
    juego.actualizarUI();
});

socket.on('retrocesoCaballo', (data) => {
    juego.logear(`🛑 ${data.palo} retrocede.`);
    juego.posiciones = data.posiciones;
    juego.actualizarUI();
});

socket.on('finCarrera', (data) => {
    if (data.ganador) {
        juego.logear(`🏆 <strong>¡GANÓ ${data.ganador.toUpperCase()}!</strong>`);
        setTimeout(() => app.procesarResultados(data.ganador), 1500);
    } else {
        juego.logear(`🏁 Carrera terminada: ${data.motivo}`);
    }
});

socket.on('actualizarSaldos', () => {
    // Recargar datos del usuario desde el servidor
    if (app.usuarioActual) {
        app.iniciarSesion(app.usuarioActual.nombre);
    }
});

// Inicializar aplicación al cargar
window.onload = function() {
    app.init();
};