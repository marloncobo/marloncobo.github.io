CREATE DATABASE IF NOT EXISTS carreras_caballos;
USE carreras_caballos;

CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    puntos INT DEFAULT 1000,
    partidas_jugadas INT DEFAULT 0,
    victorias INT DEFAULT 0,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar un usuario de prueba (opcional)
INSERT INTO usuarios (nombre, puntos) VALUES ('Admin', 99999);