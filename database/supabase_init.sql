-- ============================================================
-- EggTalk 전체 스키마 (Supabase SQL Editor에 그대로 붙여넣어 실행)
-- 의존성 순서: users -> pets -> dating_rooms -> friends -> messages -> mafia_*
-- ============================================================

-- 1) 유저
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255),                       -- 소셜 로그인 대비 NULL 허용
    provider VARCHAR(50) DEFAULT 'local',
    pet_id INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) 펫 (최신 컬럼 전체 반영)
CREATE TABLE IF NOT EXISTS pets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL 허용
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
    face VARCHAR(50) DEFAULT 'neutral',
    shape VARCHAR(50) DEFAULT 'circle',
    hand VARCHAR(50) DEFAULT 'open',
    spouse_id  INTEGER REFERENCES pets(id) ON DELETE SET NULL,
    child_id   INTEGER REFERENCES pets(id) ON DELETE SET NULL,
    parent1_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
    parent2_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
    last_chat_time TIMESTAMP,
    today_chat_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3) 데이팅(실시간 1:1) 룸
CREATE TABLE IF NOT EXISTS dating_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    creator_pet_name VARCHAR(50) NOT NULL,
    participant_pet_name VARCHAR(50),
    status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'closed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4) 친구
CREATE TABLE IF NOT EXISTS friends (
    id SERIAL PRIMARY KEY,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_no_self_request CHECK (requester_id != receiver_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_unique_pair
    ON friends (LEAST(requester_id, receiver_id), GREATEST(requester_id, receiver_id));

-- 5) 메시지
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6) 마피아 게임
CREATE TABLE IF NOT EXISTS mafia_rooms (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    host_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'waiting',   -- waiting, playing, finished
    max_players INTEGER DEFAULT 4,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mafia_participants (
    id SERIAL PRIMARY KEY,
    room_id INTEGER REFERENCES mafia_rooms(id) ON DELETE CASCADE,
    pet_id  INTEGER REFERENCES pets(id) ON DELETE CASCADE,
    is_ready BOOLEAN DEFAULT false,
    role VARCHAR(20),
    is_dead BOOLEAN DEFAULT false,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, pet_id)
);
