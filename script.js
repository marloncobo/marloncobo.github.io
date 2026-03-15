// Detectar si estamos en GitHub Pages
const isGitHubPages = window.location.hostname === 'marloncobo.github.io';
const API_URL = isGitHubPages ? 'https://marloncobogithubio-production.up.railway.app' : 'http://localhost:3000';

const socket = io(API_URL);

/* --- GESTIÓN DE LA APLICACIÓN (USUARIOS Y VISTAS) --- */
const app = {
    usuarioActual: null,
    salaActual: null,
    apuestas: [],
    jugadoresEnSala: 0,
    apuestasRealizadas: 0,
    qrCodeObj: null,
    esAnfitrion: false,
    configSala: {
        velocidadAutoPlay: 2000,
        forzarInicio: false
    },

    init: function() {
        const usuarioGuardado = localStorage.getItem('usuarioActual');
        
        const urlParams = new URLSearchParams(window.location.search);
        const salaEnUrl = urlParams.get('sala');

        if (usuarioGuardado) {
            this.usuarioActual = JSON.parse(usuarioGuardado);
            this.actualizarInfoUsuario();
            socket.emit('usuarioConectado', this.usuarioActual);
            
            if (salaEnUrl) {
                socket.emit('unirseSala', salaEnUrl);
            } else {
                this.mostrarVista('vista-salas');
            }
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
            const response = await fetch(`${API_URL}/api/registrar`, {
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
        } catch (error) { this.mostrarError(error.message); }
    },

    iniciarSesion: async function(nombreInput = null) {
        const nombre = nombreInput || document.getElementById('input-usuario').value.trim();
        if (!nombre) return this.mostrarError("Ingresa un nombre.");
        try {
            const response = await fetch(`${API_URL}/api/login`, {
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
            this.actualizarInfoUsuario();
            socket.emit('usuarioConectado', this.usuarioActual);

            const urlParams = new URLSearchParams(window.location.search);
            const salaEnUrl = urlParams.get('sala');
            if (salaEnUrl) {
                socket.emit('unirseSala', salaEnUrl);
            } else {
                this.mostrarVista('vista-salas');
            }
        } catch (error) { this.mostrarError(error.message); }
    },

    cerrarSesion: function() {
        localStorage.removeItem('usuarioActual');
        this.usuarioActual = null;
        this.mostrarVista('vista-login');
        window.history.replaceState({}, document.title, window.location.pathname);
    },

    actualizarInfoUsuario: function() {
        if (!this.usuarioActual) return;
        const elementosNombre = ['menu-usuario', 'lobby-usuario', 'nombre-apostador'];
        const elementosPuntos = ['menu-puntos', 'lobby-puntos'];
        elementosNombre.forEach(id => { const el = document.getElementById(id); if(el) el.innerText = this.usuarioActual.nombre; });
        elementosPuntos.forEach(id => { const el = document.getElementById(id); if(el) el.innerText = this.usuarioActual.puntos; });
    },

    mostrarError: function(msg) {
        const el = document.getElementById('mensaje-login');
        if(el) { el.innerText = msg; setTimeout(() => el.innerText = "", 3000); } else { alert(msg); }
    },

    crearSala: function() { socket.emit('crearSala'); },

    unirseSalaInput: function() {
        const codigo = document.getElementById('input-codigo-sala').value.trim();
        if (!codigo) return alert("Ingresa un código de sala.");
        socket.emit('unirseSala', codigo);
    },

    salirDeSala: function() {
        socket.emit('salirDeSala');
        this.salaActual = null;
        this.apuestas = [];
        this.esAnfitrion = false;
        this.mostrarVista('vista-salas');
        window.history.replaceState({}, document.title, window.location.pathname);
        document.getElementById('chat-mensajes').innerHTML = '<div class="mensaje sistema">Bienvenido al chat de la sala.</div>';
    },

    mostrarModalQR: function() {
        if (!this.salaActual) return;
        const modal = document.getElementById('modal-qr');
        const baseUrl = window.location.origin + window.location.pathname;
        const enlaceCompleto = `${baseUrl}?sala=${this.salaActual}`;
        document.getElementById('link-sala').value = enlaceCompleto;
        const qrContainer = document.getElementById('qrcode');
        qrContainer.innerHTML = ''; 
        this.qrCodeObj = new QRCode(qrContainer, {
            text: enlaceCompleto, width: 200, height: 200,
            colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H
        });
        modal.style.display = "block";
    },

    cerrarModalQR: function() { document.getElementById('modal-qr').style.display = "none"; },

    copiarEnlace: function() {
        const copyText = document.getElementById("link-sala");
        copyText.select();
        copyText.setSelectionRange(0, 99999); 
        navigator.clipboard.writeText(copyText.value).then(() => {
            alert("¡Enlace copiado al portapapeles!");
        }).catch(err => { console.error('Error al copiar: ', err); });
    },

    // --- CONFIGURACIÓN DE SALA (ANFITRIÓN) ---
    mostrarModalConfig: function() {
        if (!this.esAnfitrion) return;
        document.getElementById('config-velocidad').value = this.configSala.velocidadAutoPlay / 1000;
        document.getElementById('valor-velocidad').innerText = (this.configSala.velocidadAutoPlay / 1000) + 's';
        document.getElementById('config-forzar-inicio').value = this.configSala.forzarInicio.toString();
        document.getElementById('modal-config').style.display = "block";
    },

    cerrarModalConfig: function() {
        document.getElementById('modal-config').style.display = "none";
    },

    guardarConfigSala: function() {
        if (!this.esAnfitrion) return;
        const velocidad = parseFloat(document.getElementById('config-velocidad').value) * 1000;
        const forzarInicio = document.getElementById('config-forzar-inicio').value === 'true';

        this.configSala = { velocidadAutoPlay: velocidad, forzarInicio: forzarInicio };
        
        socket.emit('actualizarConfigSala', this.configSala);
        this.cerrarModalConfig();
        this.actualizarEstadoBotonInicio();
        alert("Configuración guardada para toda la sala.");
    },

    actualizarInterfazAnfitrion: function() {
        const btnConfig = document.getElementById('btn-config-sala');
        if (this.esAnfitrion) {
            btnConfig.style.display = 'block';
        } else {
            btnConfig.style.display = 'none';
        }
        this.actualizarEstadoBotonInicio();
    },

    // --- APUESTAS ---
    agregarApuesta: function() {
        if (this.apuestas.length >= 4) return alert("Máximo 4 jugadores por carrera.");
        const caballo = document.getElementById('apuesta-caballo').value;
        const cantidad = parseInt(document.getElementById('apuesta-cantidad').value);
        if (!cantidad || cantidad < 100) return alert("La apuesta mínima es de 100 puntos.");
        if (cantidad > this.usuarioActual.puntos) return alert("No tienes suficientes puntos.");
        
        socket.emit('realizarApuesta', { nombre: this.usuarioActual.nombre, caballo, cantidad });
        document.getElementById('apuesta-cantidad').value = "";
    },

    renderizarListaApuestas: function(apuestas) {
        const lista = document.getElementById('lista-apuestas');
        lista.innerHTML = "";
        let miApuesta = false;
        apuestas.forEach((apuesta) => {
            const li = document.createElement('li');
            li.innerHTML = `<span><strong>${apuesta.nombre}</strong>: ${apuesta.cantidad} 🟡 ${apuesta.caballo}</span>`;
            lista.appendChild(li);
            if (apuesta.nombre === this.usuarioActual.nombre) miApuesta = true;
        });

        const btnApostar = document.querySelector('.form-apuesta button');
        if (btnApostar) btnApostar.disabled = miApuesta;

        this.apuestasRealizadas = apuestas.length;
        this.actualizarEstadoBotonInicio();
    },

    actualizarEstadoBotonInicio: function() {
        const btn = document.getElementById('btn-iniciar-carrera');
        const btnRegresar = document.getElementById('btn-regresar-carrera');
        const estadoTxt = document.getElementById('estado-sala');
        
        // Si hay una carrera en curso
        if (btnRegresar && btnRegresar.style.display === 'block') {
            return; // No actualizar el estado si ya estamos viendo el botón de regresar
        }
        
        if (!this.esAnfitrion) {
            btn.disabled = true;
            btn.style.backgroundColor = "#95a5a6";
            estadoTxt.innerText = `Esperando al anfitrión... (Apuestas: ${this.apuestasRealizadas} / ${this.jugadoresEnSala})`;
            estadoTxt.style.color = "#f39c12";
            return;
        }

        if (this.jugadoresEnSala > 0 && (this.apuestasRealizadas === this.jugadoresEnSala || this.configSala.forzarInicio)) {
            btn.disabled = false;
            btn.style.backgroundColor = "#2ecc71";
            estadoTxt.innerText = "¡Listo para iniciar!";
            estadoTxt.style.color = "#2ecc71";
        } else {
            btn.disabled = true;
            btn.style.backgroundColor = "#95a5a6";
            estadoTxt.innerText = `Esperando apuestas: ${this.apuestasRealizadas} / ${this.jugadoresEnSala}`;
            estadoTxt.style.color = "#f39c12";
        }
    },

    irALaCarrera: function() { 
        if(this.esAnfitrion) socket.emit('iniciarCarrera'); 
    },

    regresarALaCarrera: function() {
        socket.emit('solicitarEstadoCarrera');
    },

    volverAlLobby: function() {
        document.getElementById('modal-resultados').style.display = "none";
        this.mostrarVista('vista-lobby');
    },

    comprarPuntos: async function(cantidad) {
        if (confirm(`¿Deseas comprar ${cantidad} puntos?`)) {
            try {
                const response = await fetch(`${API_URL}/api/comprar-puntos`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nombre: this.usuarioActual.nombre, cantidad })
                });
                if (!response.ok) throw new Error('Error al comprar puntos.');
                const usuarioActualizado = await response.json();
                this.usuarioActual = usuarioActualizado;
                this.actualizarInfoUsuario();
                alert(`¡Has comprado ${cantidad} puntos!`);
            } catch (error) { alert(error.message); }
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
    },

    // --- CHAT ---
    enviarMensajeChat: function() {
        const input = document.getElementById('input-chat');
        const texto = input.value.trim();
        if (texto) {
            socket.emit('enviarMensajeChat', texto);
            input.value = "";
        }
    },

    checkEnterChat: function(e) { if(e.key === 'Enter') this.enviarMensajeChat(); },

    agregarMensajeChat: function(usuario, texto) {
        const container = document.getElementById('chat-mensajes');
        const div = document.createElement('div');
        div.className = usuario === this.usuarioActual.nombre ? 'mensaje mio' : (usuario === 'Sistema' ? 'mensaje sistema' : 'mensaje');
        div.innerHTML = usuario === 'Sistema' ? texto : `<strong>${usuario}:</strong> ${texto}`;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
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
        
        // Solo resetear log si es una carrera nueva (cartas volteadas 0 y posiciones en 0)
        let esNueva = Object.values(this.posiciones).every(val => val === 0);
        if (esNueva) {
            document.getElementById('log').innerHTML = "<em>Carrera iniciada. ¡Buena suerte!</em><br>";
            document.getElementById('mazo-visual').style.opacity = '1';
            const cartaActiva = document.getElementById('carta-activa');
            cartaActiva.className = "carta-grande carta-vacia";
            cartaActiva.innerHTML = "TU CARTA";
            cartaActiva.style.borderColor = "rgba(255,255,255,0.3)";
            cartaActiva.style.color = "rgba(255,255,255,0.5)";
        }
        
        // Control de UI según rol
        const btnSacar = document.getElementById('btn-sacar');
        const btnAuto = document.getElementById('btn-auto');
        const msgEsperando = document.getElementById('msg-esperando-anfitrion');
        
        if (app.esAnfitrion) {
            btnSacar.style.display = 'block';
            btnAuto.style.display = 'block';
            if (!estado.autoPlayInterval) {
                btnAuto.innerHTML = "▶ Auto";
                btnAuto.style.backgroundColor = "#3498db";
            } else {
                btnAuto.innerHTML = "⏸ Pausar";
                btnAuto.style.backgroundColor = "#e67e22";
            }
            msgEsperando.style.display = 'none';
        } else {
            btnSacar.style.display = 'none';
            btnAuto.style.display = 'none';
            msgEsperando.style.display = 'block';
        }

        this.dibujarTablero();
    },

    jugarTurno: function() { 
        if(app.esAnfitrion) socket.emit('sacarCarta'); 
    },

    toggleAutoPlay: function() {
        if(!app.esAnfitrion) return;
        const btnAuto = document.getElementById('btn-auto');
        const isActive = btnAuto.innerHTML.includes("Pausar");
        socket.emit('toggleAutoPlay', !isActive);
    },

    dibujarTablero: function() {
        const carrilesDiv = document.getElementById('carriles');
        carrilesDiv.innerHTML = '';
        this.palos.forEach((palo) => {
            let carril = `<div class="carril">
                    <div class="nombre-palo" style="color: ${this.getColorPalo(palo)}">${palo}</div>
                    <div class="casillas">`;
            for(let i=0; i<=7; i++) { carril += `<div class="casilla"></div>`; }
            carril += `<div class="caballo-ficha" id="ficha-${palo}" style="left: 0px;">🐎</div></div></div>`;
            carrilesDiv.innerHTML += carril;
        });
        const pistaUI = document.getElementById('pista-ui');
        pistaUI.innerHTML = '';
        for(let i=0; i<7; i++) { pistaUI.innerHTML += `<div class="carta-pista" id="pista-${i}">?</div>`; }
        this.actualizarUI();
    },

    actualizarUI: function() {
        this.palos.forEach(palo => {
            const ficha = document.getElementById(`ficha-${palo}`);
            if (ficha) {
                const casillas = document.querySelectorAll('.casilla');
                if(casillas.length > 0) {
                    const anchoCasilla = casillas[0].offsetWidth;
                    const saltoTotal = anchoCasilla + 3; 
                    ficha.style.left = ((this.posiciones[palo] * saltoTotal) + 2) + 'px';
                } else {
                    ficha.style.left = ((this.posiciones[palo] * 47) + 2) + 'px';
                }
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
        el.style.color = color; el.style.borderColor = color;
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
socket.on('salaCreada', (data) => {
    app.salaActual = data.codigo;
    app.esAnfitrion = true;
    app.configSala = data.estado.configuracion; // Sincronizar config default
    document.getElementById('sala-codigo').innerText = data.codigo;
    document.getElementById('btn-config-sala').style.display = 'block'; // Mostrar botón config
    window.history.replaceState({}, '', `?sala=${data.codigo}`);
    
    app.mostrarVista('vista-lobby');
    app.jugadoresEnSala = data.estado.jugadores.length;
    app.renderizarListaApuestas(data.estado.apuestas);
    app.actualizarInterfazAnfitrion();
    app.agregarMensajeChat('Sistema', `Sala ${data.codigo} creada. Eres el anfitrión.`);
});

socket.on('unidoASala', (data) => {
    app.salaActual = data.codigo;
    
    // Al unirse, determinar si es el anfitrión comparando su nombre con el del estado de la sala
    app.esAnfitrion = data.estado.anfitrion === app.usuarioActual.nombre;
    
    app.configSala = data.estado.configuracion; // Sincronizar config
    document.getElementById('sala-codigo').innerText = data.codigo;
    window.history.replaceState({}, '', `?sala=${data.codigo}`);

    app.mostrarVista('vista-lobby');
    app.jugadoresEnSala = data.estado.jugadores.length;
    app.renderizarListaApuestas(data.estado.apuestas);
    app.actualizarInterfazAnfitrion();
    
    if (data.estado.enCarrera) {
        document.getElementById('btn-iniciar-carrera').style.display = 'none';
        document.getElementById('btn-regresar-carrera').style.display = 'block';
        document.getElementById('estado-sala').innerText = "La carrera ya está en curso.";
    } else {
        document.getElementById('btn-iniciar-carrera').style.display = 'block';
        document.getElementById('btn-regresar-carrera').style.display = 'none';
    }
});

socket.on('nuevoAnfitrion', (nuevoAnfitrionNombre) => {
    if (app.usuarioActual && app.usuarioActual.nombre === nuevoAnfitrionNombre) {
        app.esAnfitrion = true;
        app.actualizarInterfazAnfitrion();
        
        // Si estábamos en medio de la carrera, mostrar los botones
        if (document.getElementById('vista-juego').classList.contains('activa')) {
            document.getElementById('btn-sacar').style.display = 'block';
            document.getElementById('btn-auto').style.display = 'block';
            document.getElementById('msg-esperando-anfitrion').style.display = 'none';
        }
    }
});

socket.on('configuracionActualizada', (config) => {
    app.configSala = config;
    app.actualizarEstadoBotonInicio();
    app.agregarMensajeChat('Sistema', `El anfitrión actualizó los ajustes de la sala.`);
});

socket.on('actualizarJugadores', (jugadores) => {
    app.jugadoresEnSala = jugadores.length;
    app.actualizarEstadoBotonInicio();
});

socket.on('actualizarApuestas', (apuestas) => {
    app.apuestas = apuestas;
    app.renderizarListaApuestas(apuestas);
});

socket.on('estadoJuegoActualizado', (data) => {
    app.apuestasRealizadas = data.apuestas;
    app.jugadoresEnSala = data.jugadores;
    app.actualizarEstadoBotonInicio();
});

socket.on('inicioCarrera', (estado) => {
    app.mostrarVista('vista-juego');
    juego.inicializarDatos(estado);
    // Cambiar botones en lobby
    document.getElementById('btn-iniciar-carrera').style.display = 'none';
    document.getElementById('btn-regresar-carrera').style.display = 'block';
    document.getElementById('estado-sala').innerText = "La carrera está en curso.";
});

socket.on('estadoCarreraActual', (estado) => {
    if (estado.enCarrera) {
        app.mostrarVista('vista-juego');
        juego.inicializarDatos(estado);
    } else {
        alert("La carrera no está en curso.");
    }
});

socket.on('mensajeChat', (data) => {
    app.agregarMensajeChat(data.usuario, data.texto);
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
    if(app.esAnfitrion) {
        const btnAuto = document.getElementById('btn-auto');
        btnAuto.innerHTML = "▶ Auto";
        btnAuto.style.backgroundColor = "#3498db";
    }
    
    document.getElementById('btn-iniciar-carrera').style.display = 'block';
    document.getElementById('btn-regresar-carrera').style.display = 'none';
    app.actualizarEstadoBotonInicio();

    if (data.ganador) {
        juego.logear(`🏆 <strong>¡GANÓ ${data.ganador.toUpperCase()}!</strong>`);
        setTimeout(() => app.procesarResultados(data.ganador), 1500);
    } else {
        juego.logear(`🏁 Carrera terminada: ${data.motivo}`);
    }
});

socket.on('actualizarEstadoAutoPlay', (isActive) => {
    if(app.esAnfitrion) {
        const btnAuto = document.getElementById('btn-auto');
        if(isActive) {
            btnAuto.innerHTML = "⏸ Pausar";
            btnAuto.style.backgroundColor = "#e67e22";
        } else {
            btnAuto.innerHTML = "▶ Auto";
            btnAuto.style.backgroundColor = "#3498db";
        }
    }
});

socket.on('actualizarSaldos', () => { if (app.usuarioActual) app.iniciarSesion(app.usuarioActual.nombre); });
socket.on('error', (msg) => { alert("Error: " + msg); });
socket.on('notificacion', (msg) => { console.log("Notificación:", msg); });

window.addEventListener('resize', () => {
    if (document.getElementById('vista-juego').classList.contains('activa')) {
        juego.actualizarUI();
    }
});

window.onload = function() { app.init(); };