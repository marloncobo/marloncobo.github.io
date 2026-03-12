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
    origin: "*", // Permitir cualquier origen (GitHub Pages, localhost, etc.)
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

app.use(bodyParser.json());
app.use(express.static(__dirname));

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3000;

// --- BASE DE DATOS ---
const connectionUrl = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;
let db;

// Intentar conectar a la BD, pero no detener el servidor si falla
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
        
        // Probar conexión
        await db.query('SELECT 1');
        console.log('✅ Conexión a Base de Datos establecida.');

        // Inicializar tabla
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
        db = null; // Marcar como nula para manejarlo en los endpoints
    }
}

// --- RUTA DE SALUD (Health Check) ---
// Abre la URL de tu backend en el navegador para ver si responde
app.get('/', (req, res) => {
    res.send(`
        <h1>🐎 Servidor de Carreras Online</h1>
        <p>Estado: <strong>ACTIVO</strong></p>
        <p>Base de Datos: <strong>${db ? 'CONECTADA' : 'DESCONECTADA (Revisar Logs)'}</strong></p>
    `);
});

// --- GESTIÓN DE SALAS Y JUEGO ---
const rooms = new Map();

function generarCodigoSala() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function crearEstadoInicial() {
    return {
        enCarrera: false,
        apuestas: [],
        posiciones: { 'Oros': 0, 'Copas': 0, 'Espadas': 0, 'Bastos': 0 },
        cartasVolteadas: 0,
        pista: [],
        mazo: [],
        mazoRobo: [],
        ganador: null,
        jugadores: []
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
}

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);
    let salaActual = null;
    let nombreUsuario = null;

    socket.on('usuarioConectado', (usuario) => { nombreUsuario = usuario.nombre; });

    socket.on('crearSala', () => {
        const codigo = generarCodigoSala();
        const nuevoEstado = crearEstadoInicial();
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
        if (estado.enCarrera) return socket.emit('error', 'La carrera ya empezó.');
        
        socket.join(codigo);
        salaActual = codigo;
        if (nombreUsuario && !estado.jugadores.includes(nombreUsuario)) estado.jugadores.push(nombreUsuario);
        socket.emit('unidoASala', { codigo, estado });
        io.to(codigo).emit('notificacion', `${nombreUsuario || 'Alguien'} se unió.`);
    });

    socket.on('salirDeSala', () => {
        if (salaActual && rooms.has(salaActual)) {
            const estado = rooms.get(salaActual);
            socket.leave(salaActual);
            if(nombreUsuario) estado.jugadores = estado.jugadores.filter(n => n !== nombreUsuario);
            if (estado.jugadores.length === 0) rooms.delete(salaActual);
            salaActual = null;
        }
    });

    socket.on('realizarApuesta', async (apuesta) => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        if (estado.enCarrera) return;
        
        // Comprobar BD
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
        
        if (db) {
            const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [apuesta.nombre]);
            if(user[0]) socket.emit('actualizarUsuario', user[0]);
        }
    });

    socket.on('iniciarCarrera', () => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        if (estado.apuestas.length === 0) return;
        inicializarJuegoEnSala(estado);
        io.to(salaActual).emit('inicioCarrera', estado);
    });

    socket.on('sacarCarta', async () => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);
        if (!estado.enCarrera || estado.ganador) return;

        if (estado.mazoRobo.length === 0) {
            io.to(salaActual).emit('finCarrera', { ganador: null, motivo: 'Empate' });
            estado.enCarrera = false;
            return;
        }

        const carta = estado.mazoRobo.pop();
        estado.posiciones[carta.palo]++;
        io.to(salaActual).emit('cartaSacada', { carta, posiciones: estado.posiciones });

        if (estado.posiciones[carta.palo] >= 7) {
            estado.ganador = carta.palo;
            estado.enCarrera = false;
            
            if (db) {
                for (const apuesta of estado.apuestas) {
                    if (apuesta.caballo === carta.palo) {
                        await db.query('UPDATE usuarios SET puntos = puntos + ?, victorias = victorias + 1 WHERE nombre = ?', [apuesta.cantidad * 5, apuesta.nombre]);
                    }
                    await db.query('UPDATE usuarios SET partidas_jugadas = partidas_jugadas + 1 WHERE nombre = ?', [apuesta.nombre]);
                }
            }
            
            io.to(salaActual).emit('finCarrera', { ganador: carta.palo, motivo: 'Meta' });
            io.to(salaActual).emit('actualizarSaldos');
            setTimeout(() => {
                estado.apuestas = [];
                io.to(salaActual).emit('actualizarApuestas', []);
            }, 5000);
        } else {
            // Verificar Pista
            let minPos = Math.min(...Object.values(estado.posiciones));
            if (minPos > estado.cartasVolteadas) {
                const cartaPista = estado.pista[estado.cartasVolteadas];
                estado.cartasVolteadas++;
                io.to(salaActual).emit('cartaPistaVolteada', { carta: cartaPista, indice: estado.cartasVolteadas - 1 });
                setTimeout(() => {
                    estado.posiciones[cartaPista.palo]--;
                    io.to(salaActual).emit('retrocesoCaballo', { palo: cartaPista.palo, posiciones: estado.posiciones });
                }, 1500);
            }
        }
    });
});

// --- RUTAS API ---
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

// --- INICIO DEL SERVIDOR ---
conectarBD().then(() => {
    server.listen(port, () => {
        console.log(`🚀 Servidor corriendo en puerto ${port}`);
        console.log(`📡 URL Pública esperada: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'http://localhost:' + port}`);
    });
});