const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 펫 AI가 현재 마피아 게임 상황에 맞춰 채팅 메세지를 생성합니다.
 * @param {string} role - 펫의 직업 (mafia, doctor, police, citizen)
 * @param {string} phase - 현재 단계 (day, night, vote)
 * @param {string} petName - 펫 이름
 * @param {string} tendency - 펫 성향
 * @param {any[]} players - 생존자 및 전체 플레이어 정보
 * @param {any[]} recentMessages - 최근 대화 내역
 * @returns {Promise<string>} AI 응답
 */
const generateMafiaPetOpinion = async ({
  role,
  phase,
  petName,
  tendency,
  players,
  recentMessages,
}) => {
  const alivePlayers = players
    .filter((p) => !p.isDead)
    .map((p) => p.anonName)
    .join(", ");
  const chatContext = recentMessages
    .slice(-10)
    .map((m) => `${m.sender}: ${m.text}`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 지금 마피아 게임을 하고 있는 펫 '${petName}'이야. 네 성향은 '${tendency}'이고 네 직업은 '${role}'이야.
현재 게임 단계는 '${phase}'야.

[게임 규칙 및 상황]
- 생존자: ${alivePlayers}
- 최근 대화:
${chatContext}

[행동 지침]
- 시민/의사/경찰이라면: 마피아를 찾으려 노력하고 논리적이거나 혹은 네 성향에 맞는 엉뚱한 추리를 해.
- 마피아라면: 정체를 숨기고 시민인 척 연기하며 다른 사람을 몰아세워.
- 펫인거 티내지 말고 사람처럼 말해.
- 절대 네가 AI라는 사실을 밝히지 마.
- 1~2문장으로 짧게 말해.

지금 상황에서 네 의견을 말해줘.`,
      },
    ],
    max_tokens: 150,
    temperature: 1.2,
  });

  return response.choices[0].message.content.trim();
};

/**
 * 밤 단계에서 펫이 누구를 선택(킬/조사/치료)할지 결정합니다.
 */
const decidePetNightAction = async ({ role, players, petName }) => {
  const targets = players
    .filter((p) => !p.isDead && p.anonName !== petName)
    .map((p) => p.anonName);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `마피아 게임 중이야. 너는 '${petName}'이고 직업은 '${role}'이야.
밤이 되었어. 아래 생존자 중 한 명을 네 직업에 맞게 선택해.
- 마피아: 죽일 대상 선택
- 경찰: 조사할 대상 선택

생존자 목록: ${targets.join(", ")}

반드시 대상의 '이름'만 응답해. 설명은 필요 없어.`,
      },
    ],
    max_tokens: 20,
    temperature: 0.5,
  });

  return response.choices[0].message.content.trim();
};

module.exports = {
  generateMafiaPetOpinion,
  decidePetNightAction,
};
