const { Pool } = require("pg");
require("dotenv").config();

// DATABASE_URL(연결 문자열)이 있으면 우선 사용 (Supabase 등 관리형 PostgreSQL).
// 없으면 기존 개별 변수 방식으로 폴백.
const connectionString = process.env.DATABASE_URL;

const pool = connectionString
  ? new Pool({
      connectionString,
      // Supabase 등 관리형 DB는 SSL 필요
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_DATABASE,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    });

module.exports = { pool };
