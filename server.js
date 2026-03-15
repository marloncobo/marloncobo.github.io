require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);

// --- CONFIGURACIÓN CORS (PERMISIVA) ---
app.use(cors({
    origin: "*", 
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

app.use(bodyParser.json());
app.use(express.static(__dirname));

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const port = process.env.PORT || 3000;

// --- BASE DE DATOS ---
const connectionUrl = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;
let db;

async function conectarBD() {
    if (!connectionUrl) {
        console.warn("⚠️ ADVERTENCIA: No hay variable MYSQL_URL configurada. El servidor funcionará offline.");
        return;
    }
    try {
        db = mysql.createPool({
            uri: connectionUrl,
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });
        await db.query('SELECT 1');
        console.log('✅ Conexión a Base de Datos establecida.');

        await db.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nombre VARCHAR(50) UNIQUE NOT NULL,
                puntos INT DEFAULT 1000,
                partidas_jugadas INT DEFAULT 0,
                victorias INT DEFAULT 0,
                fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (error) {
        console.error("❌ ERROR DE CONEXIÓN A BD:", error.message);
        db = null;
    }
}

// --- GESTIÓN DE SALAS Y JUEGO ---
const rooms = new Map();
const disconnectTimeouts = new Map(); // Para manejar reconexiones si refrescan la página

function generarCodigoSala() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function crearEstadoInicial() {
    return {
        anfitrion: null,
        configuracion: {
            velocidadAutoPlay: 2000, // milisegundos
            forzarInicio: false // Si es true, el anfitrión puede iniciar sin que todos apuesten
        },
        enCarrera: false,
        apuestas: [],
        posiciones: { 'Oros': 0, 'Copas': 0, 'Espadas': 0, 'Bastos': 0 },
        cartasVolteadas: 0,
        pista: [],
        mazo: [],
        mazoRobo: [],
        ganador: null,
        jugadores: [],
        autoPlayInterval: null 
    };
}

function inicializarJuegoEnSala(estado) {
    const palos = ['Oros', 'Copas', 'Espadas', 'Bastos'];
    let cartasPermitidas = [1, 2, 3, 4, 5, 6, 7, 10, 12];
    let mazo = [];
    for (let palo of palos) {
        for (let num of cartasPermitidas) {
            mazo.push({ palo, numero: num });
        }
    }
    for (let i = mazo.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mazo[i], mazo[j]] = [mazo[j], mazo[i]];
    }
    estado.pista = mazo.splice(0, 7);
    estado.mazoRobo = mazo;
    estado.posiciones = { 'Oros': 0, 'Copas': 0, 'Espadas': 0, 'Bastos': 0 };
    estado.cartasVolteadas = 0;
    estado.enCarrera = true;
    estado.ganador = null;
    
    if(estado.autoPlayInterval) {
        clearInterval(estado.autoPlayInterval);
        estado.autoPlayInterval = null;
    }
}

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);
    let salaActual = null;
    let nombreUsuario = null;

    socket.on('usuarioConectado', (usuario) => { 
        nombreUsuario = usuario.nombre; 
    });

    socket.on('crearSala', () => {
        const codigo = generarCodigoSala();
        const nuevoEstado = crearEstadoInicial();
        nuevoEstado.anfitrion = nombreUsuario; // El creador es el anfitrión
        
        rooms.set(codigo, nuevoEstado);
        socket.join(codigo);
        salaActual = codigo;
        
        if(nombreUsuario) nuevoEstado.jugadores.push(nombreUsuario);
        socket.emit('salaCreada', { codigo, estado: nuevoEstado });
    });

    socket.on('unirseSala', (codigo) => {
        codigo = codigo ? codigo.toUpperCase() : "";
        if (!rooms.has(codigo)) return socket.emit('error', 'La sala no existe.');
        const estado = rooms.get(codigo);
        
        socket.join(codigo);
        salaActual = codigo;
        
        // Cancelar el timeout de desconexión si estaba refrescando la página
        if (nombreUsuario && disconnectTimeouts.has(nombreUsuario)) {
            clearTimeout(disconnectTimeouts.get(nombreUsuario));
            disconnectTimeouts.delete(nombreUsuario);
        }
        
        if (nombreUsuario && !estado.jugadores.includes(nombreUsuario)) {
            estado.jugadores.push(nombreUsuario);
            io.to(codigo).emit('mensajeChat', { usuario: 'Sistema', texto: `${nombreUsuario || 'Alguien'} se unió a la sala.` });
        } else if (nombreUsuario) {
            io.to(codigo).emit('mensajeChat', { usuario: 'Sistema', texto: `${nombreUsuario} se ha reconectado.` });
        }
        
        socket.emit('unidoASala', { codigo, estado });
        io.to(codigo).emit('actualizarJugadores', estado.jugadores);
    });

    // Evento de desconexión repentina (cerrar pestaña o recargar)
    socket.on('disconnect', () => {
        if (salaActual && nombreUsuario && rooms.has(salaActual)) {
            const codigo = salaActual;
            const nombre = nombreUsuario;
            
            // Damos 5 segundos de gracia por si fue solo un F5 (recarga)
            const timeout = setTimeout(() => {
                removerJugadorDeSala(codigo, nombre);
                disconnectTimeouts.delete(nombre);
            }, 5000);
            
            disconnectTimeouts.set(nombre, timeout);
        }
    });

    // Salida explícita por botón
    socket.on('salirDeSala', () => {
        if (salaActual && nombreUsuario && rooms.has(salaActual)) {
            socket.leave(salaActual);
            
            if (disconnectTimeouts.has(nombreUsuario)) {
                clearTimeout(disconnectTimeouts.get(nombreUsuario));
                disconnectTimeouts.delete(nombreUsuario);
            }
            
            removerJugadorDeSala(salaActual, nombreUsuario);
            salaActual = null;
        }
    });

    // Función auxiliar para quitar al jugador, reasignar anfitrión y limpiar sala
    function removerJugadorDeSala(codigoSala, nombre) {
        const estado = rooms.get(codigoSala);
        if (!estado) return;

        estado.jugadores = estado.jugadores.filter(n => n !== nombre);
        
        // Si no ha empezado, quitar su apuesta
        if (!estado.enCarrera) {
            const apuestaIndex = estado.apuestas.findIndex(a => a.nombre === nombre);
            if (apuestaIndex !== -1) {
                estado.apuestas.splice(apuestaIndex, 1);
                io.to(codigoSala).emit('actualizarApuestas', estado.apuestas);
                io.to(codigoSala).emit('estadoJuegoActualizado', { 
                    apuestas: estado.apuestas.length, 
                    jugadores: estado.jugadores.length 
                });
            }
        }

        // Si era el anfitrión, nombrar a otro
        if (estado.anfitrion === nombre) {
            if (estado.jugadores.length > 0) {
                estado.anfitrion = estado.jugadores[0]; // El siguiente de la lista
                io.to(codigoSala).emit('nuevoAnfitrion', estado.anfitrion);
                io.to(codigoSala).emit('mensajeChat', { usuario: 'Sistema', texto: `${estado.anfitrion} es el nuevo anfitrión.` });
            }
        }

        io.to(codigoSala).emit('actualizarJugadores', estado.jugadores);
        io.to(codigoSala).emit('mensajeChat', { usuario: 'Sistema', texto: `${nombre} salió de la sala.` });

        // Limpiar la sala si queda vacía
        if (estado.jugadores.length === 0) {
            if(estado.autoPlayInterval) clearInterval(estado.autoPlayInterval);
            rooms.delete(codigoSala);
        }
    }

    // --- CONFIGURACIÓN DE SALA ---
    socket.on('actualizarConfigSala', (nuevaConfig) => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        
        // Solo el anfitrión puede cambiar esto
        if (estado.anfitrion === nombreUsuario) {
            estado.configuracion = nuevaConfig;
            // Si el autoplay está corriendo, reiniciar el intervalo con la nueva velocidad
            if (estado.autoPlayInterval) {
                clearInterval(estado.autoPlayInterval);
                estado.autoPlayInterval = setInterval(() => {
                    sacarCartaLogica(salaActual, estado);
                }, estado.configuracion.velocidadAutoPlay);
            }
            // Avisar a todos los clientes del cambio
            io.to(salaActual).emit('configuracionActualizada', estado.configuracion);
        }
    });


    // --- CHAT ---
    socket.on('enviarMensajeChat', (texto) => {
        if (salaActual && nombreUsuario) {
            io.to(salaActual).emit('mensajeChat', { usuario: nombreUsuario, texto });
        }
    });

    socket.on('realizarApuesta', async (apuesta) => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        if (estado.enCarrera) return;

        // VERIFICAR QUE NO HAYA APOSTADO YA AL MISMO CABALLO OTRO JUGADOR
        if (estado.apuestas.some(a => a.caballo === apuesta.caballo)) {
            return socket.emit('error', `Alguien ya apostó por ${apuesta.caballo}. Elige otro caballo.`);
        }
        
        if (db) {
            try {
                const [rows] = await db.query('SELECT puntos FROM usuarios WHERE nombre = ?', [apuesta.nombre]);
                if (!rows.length || rows[0].puntos < apuesta.cantidad) return socket.emit('error', 'Saldo insuficiente.');
                await db.query('UPDATE usuarios SET puntos = puntos - ? WHERE nombre = ?', [apuesta.cantidad, apuesta.nombre]);
            } catch (e) {
                console.error(e);
                return socket.emit('error', 'Error de base de datos');
            }
        }

        estado.apuestas.push(apuesta);
        io.to(salaActual).emit('actualizarApuestas', estado.apuestas);
        
        io.to(salaActual).emit('estadoJuegoActualizado', { 
            apuestas: estado.apuestas.length, 
            jugadores: estado.jugadores.length 
        });

        if (db) {
            const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [apuesta.nombre]);
            if(user[0]) socket.emit('actualizarUsuario', user[0]);
        }
    });

    socket.on('iniciarCarrera', () => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        
        if (estado.enCarrera) return socket.emit('error', 'La carrera ya está en curso.');
        
        // Solo el anfitrión inicia
        if (estado.anfitrion !== nombreUsuario) return socket.emit('error', 'Solo el anfitrión puede iniciar la carrera.');

        // Validación: Mínimo 1 apuesta
        if (estado.apuestas.length === 0) {
            return socket.emit('error', 'Debe haber al menos 1 apuesta para iniciar la carrera.');
        }

        // Validación: Todos apuestan O el anfitrión forzó el inicio
        if (estado.apuestas.length < estado.jugadores.length && !estado.configuracion.forzarInicio) {
            return socket.emit('error', `Faltan jugadores por apostar (${estado.apuestas.length}/${estado.jugadores.length}).`);
        }
        if (estado.jugadores.length < 1) return;

        inicializarJuegoEnSala(estado);
        io.to(salaActual).emit('inicioCarrera', estado);
    });

    socket.on('solicitarEstadoCarrera', () => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        socket.emit('estadoCarreraActual', estado);
    });

    socket.on('toggleAutoPlay', (isActive) => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        
        if (estado.anfitrion !== nombreUsuario) return;

        if (isActive) {
            if(!estado.autoPlayInterval && estado.enCarrera && !estado.ganador) {
                estado.autoPlayInterval = setInterval(() => {
                    sacarCartaLogica(salaActual, estado);
                }, estado.configuracion.velocidadAutoPlay); // Usar la velocidad configurada
            }
        } else {
            if(estado.autoPlayInterval) {
                clearInterval(estado.autoPlayInterval);
                estado.autoPlayInterval = null;
            }
        }
        io.to(salaActual).emit('actualizarEstadoAutoPlay', isActive);
    });

    socket.on('sacarCarta', () => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        
        if (estado.anfitrion !== nombreUsuario) return;
        if(estado.autoPlayInterval) return;

        sacarCartaLogica(salaActual, estado);
    });

    async function sacarCartaLogica(codigoSala, estado) {
        if (!estado.enCarrera || estado.ganador) return;

        if (estado.mazoRobo.length === 0) {
            io.to(codigoSala).emit('finCarrera', { ganador: null, motivo: 'Empate' });
            estado.enCarrera = false;
            if(estado.autoPlayInterval) clearInterval(estado.autoPlayInterval);
            return;
        }

        const carta = estado.mazoRobo.pop();
        estado.posiciones[carta.palo]++;
        io.to(codigoSala).emit('cartaSacada', { carta, posiciones: estado.posiciones });

        if (estado.posiciones[carta.palo] >= 7) {
            estado.ganador = carta.palo;
            estado.enCarrera = false;
            if(estado.autoPlayInterval) clearInterval(estado.autoPlayInterval);
            
            if (db) {
                for (const apuesta of estado.apuestas) {
                    if (apuesta.caballo === carta.palo) {
                        await db.query('UPDATE usuarios SET puntos = puntos + ?, victorias = victorias + 1 WHERE nombre = ?', [apuesta.cantidad * 5, apuesta.nombre]);
                    }
                    await db.query('UPDATE usuarios SET partidas_jugadas = partidas_jugadas + 1 WHERE nombre = ?', [apuesta.nombre]);
                }
            }
            
            io.to(codigoSala).emit('finCarrera', { ganador: carta.palo, motivo: 'Meta' });
            io.to(codigoSala).emit('actualizarSaldos');
            setTimeout(() => {
                estado.apuestas = [];
                io.to(codigoSala).emit('actualizarApuestas', []);
                io.to(codigoSala).emit('estadoJuegoActualizado', { apuestas: 0, jugadores: estado.jugadores.length });
            }, 5000);
        } else {
            let minPos = Math.min(...Object.values(estado.posiciones));
            if (minPos > estado.cartasVolteadas) {
                const cartaPista = estado.pista[estado.cartasVolteadas];
                estado.cartasVolteadas++;
                
                let estabaEnAuto = false;
                if(estado.autoPlayInterval) {
                    estabaEnAuto = true;
                    clearInterval(estado.autoPlayInterval);
                    estado.autoPlayInterval = null;
                }

                io.to(codigoSala).emit('cartaPistaVolteada', { carta: cartaPista, indice: estado.cartasVolteadas - 1 });
                
                setTimeout(() => {
                    estado.posiciones[cartaPista.palo]--;
                    io.to(codigoSala).emit('retrocesoCaballo', { palo: cartaPista.palo, posiciones: estado.posiciones });
                    
                    if(estabaEnAuto && estado.enCarrera && !estado.ganador) {
                        estado.autoPlayInterval = setInterval(() => {
                            sacarCartaLogica(codigoSala, estado);
                        }, estado.configuracion.velocidadAutoPlay); // Reanudar con la velocidad configurada
                    }

                }, 1500);
            }
        }
    }
});

app.post('/api/registrar', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
    const { nombre } = req.body;
    try {
        const [exists] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        if (exists.length > 0) return res.status(409).json({ error: 'Usuario existe' });
        await db.query('INSERT INTO usuarios (nombre) VALUES (?)', [nombre]);
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        res.json(user[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
    const { nombre } = req.body;
    try {
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        if (user.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comprar-puntos', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Base de datos no disponible' });
    const { nombre, cantidad } = req.body;
    try {
        await db.query('UPDATE usuarios SET puntos = puntos + ? WHERE nombre = ?', [cantidad, nombre]);
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        res.json(user[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.send('<h1>Servidor Carreras OK</h1>'));

conectarBD().then(() => {
    server.listen(port, () => console.log(`🚀 Servidor en puerto ${port}`));
});