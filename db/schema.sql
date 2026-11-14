-- Raitu Raksha schema (MySQL 5.7+ / MariaDB 10.3+)
CREATE DATABASE IF NOT EXISTS raitu_raksha;
USE raitu_raksha;

DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS recommendations;
DROP TABLE IF EXISTS rules;
DROP TABLE IF EXISTS fertilizers;
DROP TABLE IF EXISTS crops;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  role          ENUM('user','agronomist') NOT NULL DEFAULT 'user',
  email         VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  phone         VARCHAR(15),
  location      VARCHAR(150)
);

CREATE TABLE crops (
  crop_id    INT AUTO_INCREMENT PRIMARY KEY,
  crop_name  VARCHAR(60) NOT NULL UNIQUE,
  typical_n  INT NOT NULL,          -- recommended N,  kg/ha
  typical_p  INT NOT NULL,          -- recommended P2O5, kg/ha
  typical_k  INT NOT NULL,          -- recommended K2O, kg/ha
  notes      TEXT
);

CREATE TABLE fertilizers (
  fertilizer_id INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(80) NOT NULL UNIQUE,
  n_pct         DECIMAL(5,2) NOT NULL DEFAULT 0,
  p_pct         DECIMAL(5,2) NOT NULL DEFAULT 0,   -- as P2O5
  k_pct         DECIMAL(5,2) NOT NULL DEFAULT 0,   -- as K2O
  type          VARCHAR(30) NOT NULL,              -- Straight, Complex, Organic, Amendment, Micronutrient
  instructions  TEXT
);

-- one row = one fertilizer recommendation that fires when all of its conditions match
-- NULL in a condition column means "any"; crop_id NULL means the rule applies to every crop
CREATE TABLE rules (
  rule_id        INT AUTO_INCREMENT PRIMARY KEY,
  crop_id        INT NULL,
  growth_stage   ENUM('sowing','vegetative','flowering','fruiting') NULL,
  n_level        ENUM('low','medium','high') NULL,
  p_level        ENUM('low','medium','high') NULL,
  k_level        ENUM('low','medium','high') NULL,
  ph_min         DECIMAL(3,1) NULL,
  ph_max         DECIMAL(3,1) NULL,
  fertilizer_id  INT NOT NULL,
  quantity_per_ha DECIMAL(8,1) NOT NULL,
  timing         VARCHAR(200) NOT NULL,
  precaution     VARCHAR(300),
  FOREIGN KEY (crop_id) REFERENCES crops(crop_id) ON DELETE CASCADE,
  FOREIGN KEY (fertilizer_id) REFERENCES fertilizers(fertilizer_id) ON DELETE CASCADE
);

CREATE TABLE recommendations (
  rec_id       INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  crop_id      INT NOT NULL,
  soil_input   JSON NOT NULL,
  growth_stage VARCHAR(20) NOT NULL,
  area_ha      DECIMAL(10,4) NOT NULL,
  area_input   VARCHAR(40),
  result       JSON NOT NULL,
  saved        TINYINT(1) NOT NULL DEFAULT 0,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (crop_id) REFERENCES crops(crop_id)
);

CREATE TABLE feedback (
  feedback_id INT AUTO_INCREMENT PRIMARY KEY,
  rec_id      INT NOT NULL,
  user_id     INT NOT NULL,
  rating      TINYINT NOT NULL,
  comments    VARCHAR(500),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rec_id) REFERENCES recommendations(rec_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
