/* --- GESTIÓN DE LA APLICACIÓN (USUARIOS Y VISTAS) --- */
const app = {
    usuarioActual: null,
    apuestas: [], // { nombre: "Juan", caballo: "Oros", cantidad: 100 }

    init: function() {
        // Verificar si hay sesión guardada
        const usuarioGuardado = localStorage.getItem('usuarioActual');
        if (usuarioGuardado) {
            this.usuarioActual = JSON.parse(usuarioGuardado);
            this.mostrarVista('vista-lobby');
            this.actualizarInfoUsuario();
        } else {
            this.mostrarVista('vista-login');
        }
    },

    mostrarVista: function(idVista) {
        document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
        document.getElementById(idVista).classList.add('activa');
    },

    registrarUsuario: function() {
        const nombre = document.getElementById('input-usuario').value.trim();
        if (!nombre) return this.mostrarError("Ingresa un nombre válido.");

        if (localStorage.getItem('user_' + nombre)) {
            return this.mostrarError("El usuario ya existe. Intenta iniciar sesión.");
        }

        const nuevoUsuario = { nombre: nombre, puntos: 1000 };
        localStorage.setItem('user_' + nombre, JSON.stringify(nuevoUsuario));
        this.iniciarSesion(nombre);
    },

    iniciarSesion: function(nombreInput = null) {
        const nombre = nombreInput || document.getElementById('input-usuario').value.trim();
        if (!nombre) return this.mostrarError("Ingresa un nombre.");

        const datosUsuario = localStorage.getItem('user_' + nombre);
        if (!datosUsuario) return this.mostrarError("Usuario no encontrado. Regístrate primero.");

        this.usuarioActual = JSON.parse(datosUsuario);
        localStorage.setItem('usuarioActual', JSON.stringify(this.usuarioActual));
        
        this.mostrarVista('vista-lobby');
        this.actualizarInfoUsuario();
        this.limpiarApuestas();
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
        
        // Guardar estado actualizado
        localStorage.setItem('user_' + this.usuarioActual.nombre, JSON.stringify(this.usuarioActual));
        localStorage.setItem('usuarioActual', JSON.stringify(this.usuarioActual));
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

        // Descontar puntos temporalmente (se devuelven si cancela o gana)
        this.usuarioActual.puntos -= cantidad;
        this.actualizarInfoUsuario();

        this.apuestas.push({ nombre, caballo, cantidad });
        this.renderizarListaApuestas();
        
        // Limpiar campos
        document.getElementById('apuesta-nombre').value = "";
        document.getElementById('apuesta-cantidad').value = "";
    },

    renderizarListaApuestas: function() {
        const lista = document.getElementById('lista-apuestas');
        lista.innerHTML = "";
        this.apuestas.forEach((apuesta, index) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span><strong>${apuesta.nombre}</strong> apuesta ${apuesta.cantidad} a ${apuesta.caballo}</span>
                <button onclick="app.eliminarApuesta(${index})" style="background:#e74c3c; color:white; border:none; padding:5px; border-radius:3px;">X</button>
            `;
            lista.appendChild(li);
        });

        document.getElementById('btn-iniciar-carrera').disabled = this.apuestas.length === 0;
    },

    eliminarApuesta: function(index) {
        const apuesta = this.apuestas[index];
        this.usuarioActual.puntos += apuesta.cantidad; // Devolver puntos
        this.actualizarInfoUsuario();
        
        this.apuestas.splice(index, 1);
        this.renderizarListaApuestas();
    },

    limpiarApuestas: function() {
        this.apuestas = [];
        this.renderizarListaApuestas();
    },

    irALaCarrera: function() {
        if (this.apuestas.length === 0) return;
        this.mostrarVista('vista-juego');
        juego.inicializarDatos();
    },

    volverAlLobby: function() {
        document.getElementById('modal-resultados').style.display = "none";
        this.mostrarVista('vista-lobby');
        this.limpiarApuestas(); // Reiniciar apuestas para la siguiente ronda
    },

    /* --- TIENDA DE PUNTOS --- */
    comprarPuntos: function(cantidad) {
        if (confirm(`¿Deseas comprar ${cantidad} puntos?`)) {
            this.usuarioActual.puntos += cantidad;
            this.actualizarInfoUsuario();
            alert(`¡Has comprado ${cantidad} puntos!`);
        }
    },

    procesarResultados: function(caballoGanador) {
        const modal = document.getElementById('modal-resultados');
        const lista = document.getElementById('lista-ganancias');
        const titulo = document.getElementById('titulo-ganador');
        
        titulo.innerHTML = `🏆 ¡Gana ${caballoGanador}!`;
        lista.innerHTML = "";

        this.apuestas.forEach(apuesta => {
            const div = document.createElement('div');
            if (apuesta.caballo === caballoGanador) {
                const ganancia = apuesta.cantidad * 5;
                this.usuarioActual.puntos += ganancia;
                div.className = "ganador";
                div.innerHTML = `🎉 <strong>${apuesta.nombre}</strong> ganó ${ganancia} puntos!`;
            } else {
                div.className = "perdedor";
                div.innerHTML = `❌ <strong>${apuesta.nombre}</strong> perdió ${apuesta.cantidad} puntos.`;
            }
            lista.appendChild(div);
        });

        this.actualizarInfoUsuario();
        modal.style.display = "block";
    }
};

/* --- LÓGICA DEL JUEGO (ADAPTADA) --- */
const juego = {
    palos: ['Oros', 'Copas', 'Espadas', 'Bastos'],
    mazo: [],
    pista: [],
    mazoRobo: [],
    posiciones: {},
    cartasVolteadas: 0,
    juegoTerminado: false,
    intervaloAuto: null,

    inicializarDatos: function() {
        this.detenerAutoPlay();
        this.posiciones = { 'Oros': 0, 'Copas': 0, 'Espadas': 0, 'Bastos': 0 };
        this.cartasVolteadas = 0;
        this.juegoTerminado = false;
        
        document.getElementById('btn-sacar').disabled = false;
        document.getElementById('log').innerHTML = "<em>Carrera iniciada. ¡Buena suerte!</em><br>";

        // Crear y mezclar baraja
        let cartasPermitidas = [1, 2, 3, 4, 5, 6, 7, 10, 12];
        this.mazo = [];
        for (let palo of this.palos) {
            for (let num of cartasPermitidas) {
                this.mazo.push({ palo: palo, numero: num });
            }
        }

        for (let i = this.mazo.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.mazo[i], this.mazo[j]] = [this.mazo[j], this.mazo[i]];
        }

        this.pista = this.mazo.splice(0, 7);
        this.mazoRobo = this.mazo;

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
        if (this.juegoTerminado) return;

        const btn = document.getElementById('btn-sacar');
        btn.disabled = true;

        if (this.mazoRobo.length === 0) {
            this.logear("El mazo se quedó sin cartas. Empate técnico.");
            this.juegoTerminado = true;
            this.detenerAutoPlay();
            return;
        }

        let cartaSacada = this.mazoRobo.pop();
        if (this.mazoRobo.length === 0) document.getElementById('mazo-visual').style.opacity = '0.5';
        this.mostrarCartaGrande(cartaSacada);

        this.logear(`🎯 Salió el ${cartaSacada.numero} de ${cartaSacada.palo}.`);
        this.posiciones[cartaSacada.palo]++;
        this.actualizarUI();

        if (this.posiciones[cartaSacada.palo] >= 7) {
            this.logear(`🏆 <strong>¡GANÓ ${cartaSacada.palo.toUpperCase()}!</strong>`);
            this.juegoTerminado = true;
            this.detenerAutoPlay();
            setTimeout(() => app.procesarResultados(cartaSacada.palo), 1500);
            return;
        }

        setTimeout(() => {
            this.verificarPista(btn);
        }, 800);
    },

    verificarPista: function(btn) {
        let posicionMinima = Math.min(...Object.values(this.posiciones));

        if (posicionMinima > this.cartasVolteadas) {
            let cartaPista = this.pista[this.cartasVolteadas];
            this.logear(`⚠️ ¡Todos pasaron! Se voltea: ${cartaPista.numero} de ${cartaPista.palo}.`);
            
            this.cartasVolteadas++;
            this.actualizarUI();

            this.logear(`🛑 ${cartaPista.palo} retrocede.`);

            setTimeout(() => {
                this.posiciones[cartaPista.palo]--;
                this.actualizarUI();
                if(!this.intervaloAuto) btn.disabled = false;
            }, 1000);

        } else {
            if(!this.intervaloAuto) btn.disabled = false;
        }
    },

    toggleAutoPlay: function() {
        const btnAuto = document.getElementById('btn-auto');
        if (this.intervaloAuto) {
            this.detenerAutoPlay();
        } else {
            if (this.juegoTerminado) return;
            btnAuto.innerHTML = "⏸ Pausar";
            btnAuto.style.backgroundColor = "#e67e22";
            this.intervaloAuto = setInterval(() => this.jugarTurno(), 2000);
        }
    },

    detenerAutoPlay: function() {
        clearInterval(this.intervaloAuto);
        this.intervaloAuto = null;
        const btnAuto = document.getElementById('btn-auto');
        if(btnAuto) {
            btnAuto.innerHTML = "▶ Auto";
            btnAuto.style.backgroundColor = "#3498db";
        }
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
            ficha.style.left = ((this.posiciones[palo] * 49) + 2) + 'px';
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

// Inicializar aplicación al cargar
window.onload = function() {
    app.init();
};