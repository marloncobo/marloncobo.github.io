require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise'); // Usamos la versión con promesas
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// --- CONFIGURACIÓN DE LA BASE DE DATOS (POOL) ---
const connectionUrl = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;

let db;

if (connectionUrl) {
    // ⚠️ CAMBIO IMPORTANTE: Usamos createPool en lugar de createConnection
    // El Pool maneja automáticamente la reconexión si la base de datos cierra el grifo.
    db = mysql.createPool({
        uri: connectionUrl, // Funciona en versiones recientes de mysql2
        waitForConnections: true, // Si no hay conexiones libres, espera
        connectionLimit: 5,       // Máximo 5 conexiones simultáneas (suficiente para este uso)
        queueLimit: 0,
        enableKeepAlive: true,    // Mantiene viva la conexión para evitar timeouts de Railway
        keepAliveInitialDelay: 0
    });
    
    // Si la propiedad 'uri' no es soportada por tu versión específica de driver, 
    // mysql2 suele ser inteligente y permitir pasar el string directamente al constructor:
    // db = mysql.createPool(connectionUrl); 
    // Pero la configuración de objeto arriba es más robusta si se soporta.
} else {
    console.error("❌ No se encontró URL de base de datos. Configura el archivo .env");
}

// --- GESTIÓN DE SALAS ---
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

    socket.on('usuarioConectado', (usuario) => {
        nombreUsuario = usuario.nombre;
    });

    socket.on('crearSala', () => {
        const codigo = generarCodigoSala();
        const nuevoEstado = crearEstadoInicial();
        rooms.set(codigo, nuevoEstado);
        
        socket.join(codigo);
        salaActual = codigo;
        
        nuevoEstado.jugadores.push(nombreUsuario);

        socket.emit('salaCreada', { codigo, estado: nuevoEstado });
        console.log(`Sala creada: ${codigo} por ${nombreUsuario}`);
    });

    socket.on('unirseSala', (codigo) => {
        codigo = codigo.toUpperCase();
        if (!rooms.has(codigo)) {
            socket.emit('error', 'La sala no existe.');
            return;
        }

        const estado = rooms.get(codigo);
        if (estado.enCarrera) {
            socket.emit('error', 'La carrera ya empezó.');
            return;
        }

        socket.join(codigo);
        salaActual = codigo;
        
        if (!estado.jugadores.includes(nombreUsuario)) {
            estado.jugadores.push(nombreUsuario);
        }

        socket.emit('unidoASala', { codigo, estado });
        io.to(codigo).emit('notificacion', `${nombreUsuario} se ha unido a la sala.`);
    });

    socket.on('salirDeSala', () => {
        if (salaActual && rooms.has(salaActual)) {
            const estado = rooms.get(salaActual);
            socket.leave(salaActual);
            estado.jugadores = estado.jugadores.filter(n => n !== nombreUsuario);
            io.to(salaActual).emit('notificacion', `${nombreUsuario} salió de la sala.`);
            if (estado.jugadores.length === 0) rooms.delete(salaActual);
            salaActual = null;
        }
    });

    socket.on('realizarApuesta', async (apuesta) => {
        if (!salaActual || !rooms.has(salaActual)) return;
        const estado = rooms.get(salaActual);

        if (estado.enCarrera) return;
        if (estado.apuestas.length >= 4) {
            socket.emit('error', 'Mesa llena.');
            return;
        }

        if (estado.apuestas.some(a => a.nombre === apuesta.nombre)) {
            socket.emit('error', 'Ya has realizado una apuesta.');
            return;
        }

        try {
            // db.query funciona igual con Pool que con Connection
            const [rows] = await db.query('SELECT puntos FROM usuarios WHERE nombre = ?', [apuesta.nombre]);
            if (rows.length === 0 || rows[0].puntos < apuesta.cantidad) {
                socket.emit('error', 'Saldo insuficiente.');
                return;
            }

            await db.query('UPDATE usuarios SET puntos = puntos - ? WHERE nombre = ?', [apuesta.cantidad, apuesta.nombre]);
            
            estado.apuestas.push(apuesta);
            io.to(salaActual).emit('actualizarApuestas', estado.apuestas);
            
            const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [apuesta.nombre]);
            socket.emit('actualizarUsuario', user[0]);

        } catch (err) { console.error('Error DB apuesta:', err); }
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
            await procesarPremios(salaActual, carta.palo);
            io.to(salaActual).emit('finCarrera', { ganador: carta.palo, motivo: 'Meta' });
            setTimeout(() => {
                estado.apuestas = [];
                io.to(salaActual).emit('actualizarApuestas', []);
            }, 5000);
        } else {
            verificarPista(salaActual);
        }
    });

    function verificarPista(codigoSala) {
        const estado = rooms.get(codigoSala);
        let minPos = Math.min(...Object.values(estado.posiciones));
        
        if (minPos > estado.cartasVolteadas) {
            const cartaPista = estado.pista[estado.cartasVolteadas];
            estado.cartasVolteadas++;
            io.to(codigoSala).emit('cartaPistaVolteada', { 
                carta: cartaPista, 
                indice: estado.cartasVolteadas - 1 
            });
            setTimeout(() => {
                estado.posiciones[cartaPista.palo]--;
                io.to(codigoSala).emit('retrocesoCaballo', { 
                    palo: cartaPista.palo, 
                    posiciones: estado.posiciones 
                });
            }, 1500);
        }
    }

    async function procesarPremios(codigoSala, ganador) {
        const estado = rooms.get(codigoSala);
        for (const apuesta of estado.apuestas) {
            if (apuesta.caballo === ganador) {
                const premio = apuesta.cantidad * 5;
                await db.query('UPDATE usuarios SET puntos = puntos + ?, victorias = victorias + 1 WHERE nombre = ?', [premio, apuesta.nombre]);
            }
            await db.query('UPDATE usuarios SET partidas_jugadas = partidas_jugadas + 1 WHERE nombre = ?', [apuesta.nombre]);
        }
        io.to(codigoSala).emit('actualizarSaldos');
    }
});

// --- RUTAS API ---
app.post('/api/registrar', async (req, res) => {
    const { nombre } = req.body;
    try {
        const [exists] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        if (exists.length > 0) return res.status(409).json({ error: 'Usuario existe' });

        await db.query('INSERT INTO usuarios (nombre) VALUES (?)', [nombre]);
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        res.json(user[0]);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Error interno o de conexión a BD' }); 
    }
});

app.post('/api/login', async (req, res) => {
    const { nombre } = req.body;
    try {
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        if (user.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user[0]);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Error interno o de conexión a BD' }); 
    }
});

app.post('/api/comprar-puntos', async (req, res) => {
    const { nombre, cantidad } = req.body;
    try {
        await db.query('UPDATE usuarios SET puntos = puntos + ? WHERE nombre = ?', [cantidad, nombre]);
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        res.json(user[0]);
    } catch (e) { 
        console.error(e);
        res.status(500).json({ error: 'Error interno' }); 
    }
});

async function start() {
    try {
        if(db) {
            // Verificamos conexión simple
            console.log('🔌 Intentando conectar al Pool de MySQL...');
            await db.query('SELECT 1'); 
            console.log('✅ Conexión al Pool establecida correctamente.');

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
            console.log('✅ Tabla usuarios verificada.');
        } else {
            console.log("⚠️ Modo Offline (Sin base de datos configurada).");
        }
        server.listen(port, () => console.log(`🚀 Server en puerto ${port}`));
    } catch (e) { console.error('❌ Error Fatal al iniciar:', e); }
}
start();