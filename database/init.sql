-- 유저 테이블 생성
DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),
    provider VARCHAR(50) DEFAULT 'local',
    pet_id INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 펫 테이블 생성
DROP TABLE IF EXISTS pets CASCADE;
CREATE TABLE pets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(50) NOT NULL,
    level INTEGER DEFAULT 1,
    exp INTEGER DEFAULT 0,
    hunger INTEGER DEFAULT 100,
    cleanliness INTEGER DEFAULT 100,
    health_hp INTEGER DEFAULT 100,
    stress INTEGER DEFAULT 0,
    knowledge INTEGER DEFAULT 0,
    affection INTEGER DEFAULT 0,
    altruism INTEGER DEFAULT 0,
    logic INTEGER DEFAULT 0,
    empathy INTEGER DEFAULT 0,
    extroversion INTEGER DEFAULT 0,
    humor INTEGER DEFAULT 0,
    openness INTEGER DEFAULT 0,
    directness INTEGER DEFAULT 0,
    curiosity INTEGER DEFAULT 0,
    tendency VARCHAR(50) DEFAULT 'neutral',
    last_chat_time TIMESTAMP,
    today_chat_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);