require('dotenv').config(); // Cargar variables de entorno desde .env

const express = require('express');
const http = require('https');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permitir conexiones desde cualquier lugar
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3000;

// --- MIDDLEWARE ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// --- CONFIGURACIÓN BASE DE DATOS ---
// Prioridad: 1. MYSQL_PUBLIC_URL (Para desarrollo local desde tu PC)
//            2. MYSQL_URL (Variable automática interna de Railway en producción)
const connectionUrl = process.env.MYSQL_PUBLIC_URL || process.env.MYSQL_URL;

if (!connectionUrl) {
    console.error("❌ Error: No se encontró la variable de entorno MYSQL_URL o MYSQL_PUBLIC_URL.");
    console.error("Asegúrate de crear un archivo .env con las credenciales o configurar las variables en Railway.");
    process.exit(1);
}

if (!connectionUrl.startsWith('mysql://')) {
    console.error("❌ Error de Formato: La URL de conexión no es válida.");
    console.error("   Parece que solo has copiado el 'Host' en lugar de la URL completa.");
    console.error(`   Valor actual: ${connectionUrl}`);
    console.error("   👉 Solución: En Railway, copia la 'Connection URL' completa (empieza por mysql://).");
    process.exit(1);
}

// --- DIAGNÓSTICO DE CONEXIÓN ---
try {
    // Ocultamos la contraseña para mostrar el log seguro
    const urlSegura = connectionUrl.replace(/:([^:@]+)@/, ':****@');
    console.log(`🔌 Intentando conectar a: ${urlSegura}`);
    
    const urlObj = new URL(connectionUrl);
    if (urlObj.hostname === 'localhost' && !process.env.MYSQL_PUBLIC_URL.includes('localhost')) {
        console.warn("⚠️  ALERTA: Tu URL se está interpretando como 'localhost'. Probablemente tienes caracteres especiales en tu contraseña que rompen el formato.");
    }
} catch (e) {
    console.log("⚠️  Error: La cadena de conexión no es una URL válida.");
}

let db;

// --- ESTADO DEL JUEGO ---
let estadoJuego = {
    enCarrera: false,
    apuestas: [],
    posiciones: { 'Oros': 0, 'Copas': 0, 'Espadas': 0, 'Bastos': 0 },
    cartasVolteadas: 0,
    pista: [],
    mazo: [],
    mazoRobo: [],
    ganador: null
};

// --- FUNCIONES DEL JUEGO ---
function inicializarJuego() {
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

    estadoJuego.pista = mazo.splice(0, 7);
    estadoJuego.mazoRobo = mazo;
    estadoJuego.posiciones = { 'Oros': 0, 'Copas': 0, 'Espadas': 0, 'Bastos': 0 };
    estadoJuego.cartasVolteadas = 0;
    estadoJuego.enCarrera = true;
    estadoJuego.ganador = null;
}

// --- LÓGICA AUXILIAR (Movida fuera del socket) ---
function verificarPista() {
    let minPos = Math.min(...Object.values(estadoJuego.posiciones));
    if (minPos > estadoJuego.cartasVolteadas) {
        const cartaPista = estadoJuego.pista[estadoJuego.cartasVolteadas];
        estadoJuego.cartasVolteadas++;
        
        io.emit('cartaPistaVolteada', { 
            carta: cartaPista, 
            indice: estadoJuego.cartasVolteadas - 1 
        });

        setTimeout(() => {
            estadoJuego.posiciones[cartaPista.palo]--;
            io.emit('retrocesoCaballo', { 
                palo: cartaPista.palo, 
                posiciones: estadoJuego.posiciones 
            });
        }, 1500);
    }
}

async function procesarPremios(ganador) {
    for (const apuesta of estadoJuego.apuestas) {
        if (apuesta.caballo === ganador) {
            const premio = apuesta.cantidad * 5;
            await db.query('UPDATE usuarios SET puntos = puntos + ?, victorias = victorias + 1 WHERE nombre = ?', [premio, apuesta.nombre]);
        }
        await db.query('UPDATE usuarios SET partidas_jugadas = partidas_jugadas + 1 WHERE nombre = ?', [apuesta.nombre]);
    }
    io.emit('actualizarSaldos');
}

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);
    socket.emit('estadoActual', estadoJuego);

    socket.on('usuarioConectado', (usuario) => {
        io.emit('notificacion', `${usuario.nombre} se ha unido.`);
    });

    socket.on('realizarApuesta', async (apuesta) => {
        if (estadoJuego.enCarrera) return;
        if (estadoJuego.apuestas.length >= 4) {
            socket.emit('error', 'Mesa llena.');
            return;
        }

        try {
            const [rows] = await db.query('SELECT puntos FROM usuarios WHERE nombre = ?', [apuesta.nombre]);
            if (rows.length === 0 || rows[0].puntos < apuesta.cantidad) {
                socket.emit('error', 'Saldo insuficiente.');
                return;
            }

            await db.query('UPDATE usuarios SET puntos = puntos - ? WHERE nombre = ?', [apuesta.cantidad, apuesta.nombre]);
            
            estadoJuego.apuestas.push(apuesta);
            io.emit('actualizarApuestas', estadoJuego.apuestas);
            
            const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [apuesta.nombre]);
            socket.emit('actualizarUsuario', user[0]);

        } catch (err) {
            console.error(err);
        }
    });

    socket.on('iniciarCarrera', () => {
        if (estadoJuego.apuestas.length === 0) return;
        inicializarJuego();
        io.emit('inicioCarrera', estadoJuego);
    });

    socket.on('sacarCarta', async () => {
        if (!estadoJuego.enCarrera || estadoJuego.ganador) return;

        if (estadoJuego.mazoRobo.length === 0) {
            io.emit('finCarrera', { ganador: null, motivo: 'Empate' });
            estadoJuego.enCarrera = false;
            return;
        }

        const carta = estadoJuego.mazoRobo.pop();
        estadoJuego.posiciones[carta.palo]++;
        
        io.emit('cartaSacada', { carta, posiciones: estadoJuego.posiciones });

        if (estadoJuego.posiciones[carta.palo] >= 7) {
            estadoJuego.ganador = carta.palo;
            estadoJuego.enCarrera = false;
            
            await procesarPremios(carta.palo);
            
            io.emit('finCarrera', { ganador: carta.palo, motivo: 'Meta' });
            
            setTimeout(() => {
                estadoJuego.apuestas = [];
                io.emit('actualizarApuestas', []);
            }, 5000);
        } else {
            verificarPista();
        }
    });
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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
    const { nombre } = req.body;
    try {
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        if (user.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(user[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/comprar-puntos', async (req, res) => {
    const { nombre, cantidad } = req.body;
    try {
        await db.query('UPDATE usuarios SET puntos = puntos + ? WHERE nombre = ?', [cantidad, nombre]);
        const [user] = await db.query('SELECT * FROM usuarios WHERE nombre = ?', [nombre]);
        res.json(user[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- INICIO ---
async function start() {
    try {
        // Conexión usando la URL completa (Railway style)
        db = await mysql.createConnection(connectionUrl);
        console.log('✅ Conectado a MySQL Railway');
        
        // Crear tabla si no existe (útil para el primer despliegue)
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
        console.log('✅ Tabla usuarios verificada');

        server.listen(port, () => console.log(`🚀 Server en puerto ${port}`));
    } catch (e) {
        console.error('❌ Error DB:', e.message);
        if (e.code === 'ENOTFOUND' && e.message.includes('railway.internal')) {
            console.log('\n⚠️  AVISO: Estás intentando conectar a una URL interna de Railway desde tu PC.');
            console.log('   Asegúrate de definir MYSQL_PUBLIC_URL en tu archivo .env con la "Public Networking URL" de Railway.\n');
        }
    }
}
start();