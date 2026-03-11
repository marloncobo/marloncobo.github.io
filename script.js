const socket = io(); // Conectar al servidor WebSocket

/* --- GESTIÓN DE LA APLICACIÓN (USUARIOS Y VISTAS) --- */
const app = {
    usuarioActual: null,
    salaActual: null,
    apuestas: [],

    init: function() {
        // Verificar si hay sesión guardada
        const usuarioGuardado = localStorage.getItem('usuarioActual');
        if (usuarioGuardado) {
            this.usuarioActual = JSON.parse(usuarioGuardado);
            this.actualizarInfoUsuario();
            this.mostrarVista('vista-salas'); // Ir a menú de salas, no directo al lobby
            socket.emit('usuarioConectado', this.usuarioActual);
        } else {
            this.mostrarVista('vista-login');
        }
    },

    mostrarVista: function(idVista) {
        document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
        document.getElementById(idVista).classList.add('activa');
    },

    // --- LOGIN / REGISTRO ---
    registrarUsuario: async function() {
        const nombre = document.getElementById('input-usuario').value.trim();
        if (!nombre) return this.mostrarError("Ingresa un nombre válido.");

        try {
            const response = await fetch('/api/registrar', {
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
            const response = await fetch('/api/login', {
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
            this.mostrarVista('vista-salas');
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
        // Actualizar en todas las vistas donde aparece info del usuario
        const elementosNombre = ['menu-usuario', 'lobby-usuario', 'nombre-apostador'];
        const elementosPuntos = ['menu-puntos', 'lobby-puntos'];

        elementosNombre.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.innerText = this.usuarioActual.nombre;
        });

        elementosPuntos.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.innerText = this.usuarioActual.puntos;
        });
    },

    mostrarError: function(msg) {
        const el = document.getElementById('mensaje-login');
        if(el) {
            el.innerText = msg;
            setTimeout(() => el.innerText = "", 3000);
        } else {
            alert(msg);
        }
    },

    // --- GESTIÓN DE SALAS ---
    crearSala: function() {
        socket.emit('crearSala');
    },

    unirseSala: function() {
        const codigo = document.getElementById('input-codigo-sala').value.trim();
        if (!codigo) return alert("Ingresa un código de sala.");
        socket.emit('unirseSala', codigo);
    },

    salirDeSala: function() {
        socket.emit('salirDeSala');
        this.salaActual = null;
        this.apuestas = [];
        this.mostrarVista('vista-salas');
    },

    // --- GESTIÓN DE APUESTAS ---
    agregarApuesta: function() {
        if (this.apuestas.length >= 4) return alert("Máximo 4 jugadores por carrera.");

        const caballo = document.getElementById('apuesta-caballo').value;
        const cantidad = parseInt(document.getElementById('apuesta-cantidad').value);

        if (!cantidad || cantidad < 100) return alert("La apuesta mínima es de 100 puntos.");
        if (cantidad > this.usuarioActual.puntos) return alert("No tienes suficientes puntos.");

        // Enviar apuesta al servidor (sala actual)
        socket.emit('realizarApuesta', { 
            nombre: this.usuarioActual.nombre, 
            caballo, 
            cantidad 
        });
        
        // Limpiar campo cantidad
        document.getElementById('apuesta-cantidad').value = "";
    },

    renderizarListaApuestas: function(apuestas) {
        const lista = document.getElementById('lista-apuestas');
        lista.innerHTML = "";
        
        let miApuesta = false;

        apuestas.forEach((apuesta) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span><strong>${apuesta.nombre}</strong>: ${apuesta.cantidad} 🟡 ${apuesta.caballo}</span>
            `;
            lista.appendChild(li);

            if (apuesta.nombre === this.usuarioActual.nombre) {
                miApuesta = true;
            }
        });

        // Habilitar botón de inicio solo si hay apuestas (cualquiera puede iniciar por ahora)
        document.getElementById('btn-iniciar-carrera').disabled = apuestas.length === 0;
        
        // Deshabilitar botón de apostar si ya apostaste
        const btnApostar = document.querySelector('.form-apuesta button');
        if (btnApostar) btnApostar.disabled = miApuesta;
    },

    irALaCarrera: function() {
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
                const response = await fetch('/api/comprar-puntos', {
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
socket.on('salaCreada', (data) => {
    app.salaActual = data.codigo;
    document.getElementById('sala-codigo').innerText = data.codigo;
    app.mostrarVista('vista-lobby');
    app.renderizarListaApuestas(data.estado.apuestas);
    // Habilitar botón apostar
    const btnApostar = document.querySelector('.form-apuesta button');
    if (btnApostar) btnApostar.disabled = false;
});

socket.on('unidoASala', (data) => {
    app.salaActual = data.codigo;
    document.getElementById('sala-codigo').innerText = data.codigo;
    app.mostrarVista('vista-lobby');
    app.renderizarListaApuestas(data.estado.apuestas);
    // Verificar si ya aposté en esta sala
    const yaAposte = data.estado.apuestas.some(a => a.nombre === app.usuarioActual.nombre);
    const btnApostar = document.querySelector('.form-apuesta button');
    if (btnApostar) btnApostar.disabled = yaAposte;
});

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
    if (app.usuarioActual) {
        app.iniciarSesion(app.usuarioActual.nombre);
    }
});

socket.on('error', (msg) => {
    alert("Error: " + msg);
});

socket.on('notificacion', (msg) => {
    // Podrías usar un toast o algo más elegante
    console.log("Notificación:", msg);
});

// Inicializar aplicación al cargar
window.onload = function() {
    app.init();
};