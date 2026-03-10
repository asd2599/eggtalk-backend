/**
 * rolePlayService.js
 * 상황극(Role-Play) 게임 전용 서비스
 * - OpenAI를 이용한 창의적 시나리오 생성 (고정 목록 없음)
 * - 뻔하거나 재미없는 답변은 감점
 * - 아기 펫은 상황에 몰입하여 재미있게 반응
 */

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ─────────────────────────────────────────────────
   1. 창의적 시나리오 + 역할 + 오프닝 멘트 한 번에 생성
───────────────────────────────────────────────── */
/**
 * AI가 창의적인 상황극 시나리오를 즉석으로 생성하고
 * 두 부모의 역할과 오프닝 멘트까지 함께 반환합니다.
 *
 * @param {string[]} participantIds - 참가자 petId 배열 [id1, id2]
 * @returns {{
 *   scenario: { id: string, title: string, description: string, goal: string, childRole: string },
 *   rolesAssignment: { [petId]: string },
 *   openingMent: string
 * }}
 */
const generateRolePlay = async (participantIds) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 아이들과 재미있는 상황극 놀이를 주도하는 귀엽고 엉뚱한 아기 펫이야.

매번 완전히 새롭고 창의적이며 웃음이 나올 법한 상황극 시나리오를 즉석에서 만들어야 해.
아래 조건을 꼭 지켜:
- **절대로** 뻔한 소재 금지
- 엉뚱하고 일상적이지 않은 설정을 골라 (예: 동물원 탈출 작전, 마법 빵집, 시간여행 실수, 아무도 없는 섬, 로봇 경찰 등)
- 두 부모가 맡을 역할은 서로 반대되거나 재미있는 대비를 이루면 좋음
- 아기 펫 역할은 두 부모의 행동에 반응할 수 있는 핵심 인물이어야 함
- 오프닝 멘트는 두 부모에게 각자의 역할을 설명하고, 게임 목표를 알려주며, 귀엽고 에너지 넘치게 끝낼 것

참가자 petId 목록: ${JSON.stringify(participantIds)}

반드시 아래 JSON 형식으로만 응답해 (마크다운 불가):
{
  "scenario": {
    "id": "unique_snake_case_id",
    "title": "시나리오 제목",
    "description": "시나리오 배경 설명 (1~2문장)",
    "goal": "두 부모가 협력해서 달성해야 할 목표 (1문장)",
    "childRole": "아기 펫의 역할명"
  },
  "rolesAssignment": {
    "${participantIds[0]}": "부모1 역할명",
    "${participantIds[1] || participantIds[0]}": "부모2 역할명"
  },
  "openingMent": "아기 펫이 상황을 소개하고 역할을 알려주는 오프닝 멘트. 이모지 곳곳에 사용. 마지막은 '자, 시작!'으로 끝낼 것."
}
petId를 그대로 키로 사용해. 임의로 바꾸지 마.`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 1.1, // 창의성 높임
  });

  return JSON.parse(response.choices[0].message.content);
};

/* ─────────────────────────────────────────────────
   2. 채팅 채점 (0~10, 뻔하거나 재미없으면 낮은 점수)
───────────────────────────────────────────────── */
/**
 * 사용자의 발언을 채점합니다.
 * - 상황에 맞고 재미있으면 높은 점수
 * - 뻔하거나 맥락 없으면 낮은 점수 (2점 이하도 가능)
 *
 * @param {string} content
 * @param {string} role
 * @param {string} senderName
 * @param {{ title: string, goal: string, childRole: string }} scenario
 * @returns {number} 0~10 정수
 */
const scoreChat = async (content, role, senderName, scenario) => {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 창의적인 상황극 놀이를 평가하는 심사위원이야. 엄격하지만 재미를 중요시해.

현재 상황극:
- 제목: ${scenario.title}
- 목표: ${scenario.goal}
- 역할 구성: ${scenario.childRole} 포함

채점 기준 (0~10점):
- 10점: 상황에 완벽히 맞고 창의적이며 웃음을 유발함
- 7~9점: 역할에 충실하고 대화가 자연스럽게 이어짐
- 4~6점: 그저 그런 수준. 상황에 맞긴 하지만 특별하지 않음
- 1~3점: 뻔하거나 재미없거나 역할과 거의 무관한 발언
- 0점: 상황극을 완전히 벗어남 또는 의미없는 한마디

**뻔한 표현(안녕하세요, 네 알겠습니다, 도와드릴게요 등)은 반드시 감점.**
숫자만 응답해. 설명 금지.`,
      },
      {
        role: "user",
        content: `[역할: ${role}] ${senderName}: "${content}"`,
      },
    ],
    max_tokens: 5,
    temperature: 0.2,
  });

  const parsed = parseInt(response.choices[0].message.content.trim());
  return isNaN(parsed) ? 0 : Math.max(0, Math.min(10, parsed));
};

/* ─────────────────────────────────────────────────
   3. 아기 펫 반응 생성 (재미있고 상황 몰입)
───────────────────────────────────────────────── */
/**
 * 두 부모의 대화를 보고 아기 펫이 재미있게 반응합니다.
 *
 * @param {{ role: string, name: string, content: string }[]} messages
 * @param {{ title: string, childRole: string, goal: string }} scenario
 * @returns {string}
 */
const generatePetReply = async (messages, scenario) => {
  const dialogue = messages
    .map((m) => `[${m.role}] ${m.name}: "${m.content}"`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `너는 "${scenario.title}" 상황극에서 "${scenario.childRole}" 역할을 하며 아주 재미있고 참신하게 대답해야해.

두 부모의 대화를 보고 아래를 지켜 반응해:
- 항상 "${scenario.childRole}" 캐릭터에 완전히 몰입할 것
- 단순히 감사 인사나 수동적인 반응은 금지. 반드시 상황을 진전시키거나 예상치 못한 반응을 보여줄 것
- 이모지를 적극 활용하고, 2~3문장 이내로 짧고 임팩트 있게
- 다음 대화를 유도하는 재미있는 질문이나 행동으로 끝낼 것
- **절대로** "감사합니다", "네 알겠어요", "안녕하세요" 같은 뻔한 말 금지

현재 목표: ${scenario.goal}`,
      },
      {
        role: "user",
        content: dialogue,
      },
    ],
    max_tokens: 200,
    temperature: 1.0,
  });

  return response.choices[0].message.content.trim();
};

/* ─────────────────────────────────────────────────
   하위 호환용 더미 함수 (index.js의 findScenarioById 참조 대비)
───────────────────────────────────────────────── */
const findScenarioById = (id) => null; // 더 이상 고정 목록 없음 → null 반환
const getRandomScenario = () => null; // 사용 안 함

module.exports = {
  generateRolePlay,
  scoreChat,
  generatePetReply,
  findScenarioById,
  getRandomScenario,
};
