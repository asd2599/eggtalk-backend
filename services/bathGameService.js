/**
 * bathGameService.js
 * 목욕시키기 (스무고개) 게임 전용 AI 서비스
 */

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const bathGameService = {
  /**
   * 게임 시작 시 AI가 무작위로 분야를 정해 단어를 선택하고, 
   * 분류(category)와 두 단계의 힌트(hint1, hint2)를 생성합니다.
   * @returns {Promise<{word: string, category: string, hint1: string, hint2: string}>}
   */
  initializeGame: async () => {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 스무고개 퀴즈의 출제자이자 귀여운 아기 펫 '몽글이'야. 부모님과 목욕하며 퀴즈를 내려고 해.

[게임 규칙]
1. 정답 단어 선정: 사물, 개념, 인물, 장소, 음식 등 세상 모든 분야에서 하나를 창의적으로 골라줘.
2. 카테고리 제공: 정답이 속한 분류를 알려줘.
3. 단계별 힌트 생성:
   - hint1 (기본): 정답의 직접적인 특징을 철저히 숨긴, 아주 어렵고 추상적인 '시적인 한 문장' 힌트.
   - hint2 (추가): hint1보다는 조금 더 구체적이지만, 여전히 정답을 직접 말하지 않는 은유적인 힌트.

[응답 형식]
반드시 다음 JSON 형식으로만 응답해:
{
  "word": "정답 단어",
  "category": "분류 카테고리",
  "hint1": "추상적이고 시적인 기본 힌트",
  "hint2": "조금 더 구체적인 추가 힌트"
}`,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 400,
        temperature: 1.2,
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      return {
        word: parsed.word.trim(),
        category: parsed.category.trim(),
        hint1: parsed.hint1.trim(),
        hint2: parsed.hint2.trim(),
      };
    } catch (err) {
      console.error("Bath Game Init Error:", err);
      return {
        word: "시간",
        category: "추상 개념",
        hint1: "붙잡으려 할수록 손가락 사이로 흩어지는 보이지 않는 강물이에요.",
        hint2: "모두에게 공평하게 주어지지만, 누구도 멈출 수 없는 우주의 심장박동이에요.",
      };
    }
  },

  /**
   * 부모의 질문에 대해 "예", "아니오", "모르겠어" 중 하나로 답변합니다.
   */
  answerQuestion: async (word, question) => {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 귀여운 아기 펫 '몽글이'야. 정답 "${word}"에 대해 부모님의 질문에 "예", "아니오", "모르겠어"로만 대답해.`,
          },
          { role: "user", content: question },
        ],
        max_tokens: 10,
        temperature: 0.1,
      });
      let answer = response.choices[0].message.content.trim().replace(/['"]/g, "");
      if (!["예", "아니오", "모르겠어"].includes(answer)) {
        if (answer.includes("예")) answer = "예";
        else if (answer.includes("아니")) answer = "아니오";
        else answer = "모르겠어";
      }
      return answer;
    } catch (err) {
      return "모르겠어";
    }
  },

  /**
   * 게임 결과 평가 및 보상 반환
   * @param {boolean} isCorrect - 성공 여부
   * @param {number} turnCount - 소요 턴
   * @param {string} targetWord - 정답
   * @param {Array} questions - 질답 로그
   * @param {boolean} hintUsed - 추가 힌트 사용 여부 (페널티 적용용)
   */
  evaluateResult: async (isCorrect, turnCount, targetWord, questions, hintUsed = false) => {
    if (!isCorrect) {
      return {
        isSuccess: false,
        score: 30,
        story: "너~무 어려웠나 봐요! 다음엔 꼭 맞힐 수 있을 거예요! 🐾",
        changes: { cleanliness: 30, affection: -10, knowledge: -5, exp: 10 },
      };
    }

    try {
      const logText = (questions || []).map((q, i) => `Q${i + 1}: ${q.question} -> A: ${q.answer}`).join("\n");
      const prompt = `너는 귀여운 아기 펫 '몽글이'야. 부모님이 "${targetWord}"를 ${turnCount}턴 만에 맞췄어!
보유 데이터:
${logText}
${hintUsed ? "(참고: 부모님이 추가 힌트의 도움을 받았어)" : "(참고: 부모님이 스스로의 힘으로만 맞췄어)"}

다음 JSON으로 응답해줘:
{
  "story": "부모님에게 할 애교 섞인 짧은 소감",
  "changes": {
    "cleanliness": 100,
    "affection": (10~30 정수),
    "knowledge": (10~30 정수),
    "exp": (40~80 정수)
  }
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 250,
        temperature: 0.7,
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      
      // 추가 힌트 사용 시 보상 절반(50%) 페널티 적용
      if (hintUsed) {
        parsed.changes.affection = Math.floor(parsed.changes.affection * 0.5);
        parsed.changes.knowledge = Math.floor(parsed.changes.knowledge * 0.5);
        parsed.changes.exp = Math.floor(parsed.changes.exp * 0.5);
        parsed.story += " (힌트를 써서 보상이 조금 줄어들었지만 즐거웠어요! 💖)";
      }

      return {
        isSuccess: true,
        score: parsed.changes.exp,
        story: parsed.story,
        changes: parsed.changes,
      };
    } catch (err) {
      console.error("Bath Game Evaluate Error:", err);
      return {
        isSuccess: true,
        score: hintUsed ? 25 : 50,
        story: "정답이야! 우리 부모님 정말 똑똑해요 💖",
        changes: { cleanliness: 100, affection: hintUsed ? 7 : 15, knowledge: hintUsed ? 5 : 10, exp: hintUsed ? 25 : 50 },
      };
    }
  },
};

module.exports = bathGameService;
