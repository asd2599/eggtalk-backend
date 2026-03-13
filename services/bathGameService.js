/**
 * bathGameService.js
 * 목욕시키기 (스무고개) 게임 전용 AI 서비스
 */

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 게임용 단어 목록 (원하면 더 추가 가능)
const wordList = [
  "사과",
  "바나나",
  "고양이",
  "강아지",
  "자동차",
  "비행기",
  "우주선",
  "컴퓨터",
  "스마트폰",
  "텔레비전",
  "피아노",
  "기타",
  "자전거",
  "기차",
  "의자",
  "책상",
  "침대",
  "냉장고",
  "세탁기",
  "신발",
];

const bathGameService = {
  /**
   * 게임 시작 시 정답 단어를 랜덤으로 선택하고, 첫 번째 힌트를 반환합니다.
   * @returns {Promise<{word: string, hint: string}>} 정답 단어와 힌트
   */
  initializeGame: async () => {
    const randomIndex = Math.floor(Math.random() * wordList.length);
    const selectedWord = wordList[randomIndex];

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 귀여운 아기 펫 '몽글이'야. 지금 목욕탕에서 부모님과 스무고개 놀이를 하고 있어.
정답 단어는 "${selectedWord}"야.
부모님들이 단어를 맞힐 수 있도록, 단어에 대한 '결정적이지만 재미있고 귀여운 힌트'를 딱 한 줄의 문자열로만 만들어 줘.
예: "이건 아주 달콤하고 빨간 과일이에요!"`,
          },
        ],
        max_tokens: 100,
        temperature: 0.9,
      });

      return {
        word: selectedWord,
        hint: response.choices[0].message.content.trim(),
      };
    } catch (err) {
      console.error("Bath Game Init Error:", err);
      // 폴백 처리
      return {
        word: "사과",
        hint: "이건 아주 달콤하고 빨간 과일이에요!",
      };
    }
  },

  /**
   * 부모의 질문에 대해 "예", "아니오", "모르겠어" 중 하나로 답변합니다.
   * @param {string} word - 현재 게임의 정답 단어
   * @param {string} question - 부모가 다는 질문
   * @returns {Promise<string>} 답변 ("예", "아니오", "모르겠어" 중 한 가지)
   */
  answerQuestion: async (word, question) => {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `너는 귀여운 아기 펫 '몽글이'야. 부모님과 스무고개 놀이를 하고 있어.
지금 정답 단어는 "${word}"야.
부모님이 던지는 질문에 대해 오직 "예", "아니오", "모르겠어" 세 가지 중 하나로만 대답해야 해. 다른 말은 절대 덧붙이지 마.`,
          },
          {
            role: "user",
            content: question,
          },
        ],
        max_tokens: 10,
        temperature: 0.1, // 창의성보다는 정확성 요구
      });

      // 안전장치로 답변 정리 (불필요한 공백/따옴표 제거)
      let answer = response.choices[0].message.content
        .trim()
        .replace(/['"]/g, "");

      // 만약 예/아니오/모르겠어로 안 끝나면 기본값 반환
      if (!["예", "아니오", "모르겠어"].includes(answer)) {
        if (answer.includes("예")) answer = "예";
        else if (answer.includes("아니")) answer = "아니오";
        else answer = "모르겠어";
      }

      return answer;
    } catch (err) {
      console.error("Bath Game Answer Error:", err);
      return "모르겠어";
    }
  },

  /**
   * 게임 종료 시 결과를 평가하고 보상 및 스토리를 반환합니다.
   * @param {boolean} isCorrect - 정답 맞힘 여부
   * @param {number} turnCount - 소요된 턴 수 (최대 20)
   * @param {string} targetWord - 정답 단어
   * @param {Array} questions - 오간 질문과 답변 배열 [{question, answer}]
   * @returns {Promise<{isSuccess: boolean, score: number, story: string, changes: object}>} 결과
   */
  evaluateResult: async (isCorrect, turnCount, targetWord, questions) => {
    if (!isCorrect) {
      return {
        isSuccess: false,
        score: 30,
        story:
          "너~무 어려웠나 봐요! 정답을 맞히지 못했지만, 다음엔 꼭 맞힐 수 있을 거예요! 🐾",
        changes: { cleanliness: 30, affection: -10, knowledge: -5, exp: 10 },
      };
    }

    try {
      // 질문 로그 문자열화
      const logText = (questions || [])
        .map((q, i) => `Q${i + 1}: ${q.question} -> A: ${q.answer}`)
        .join("\n");
      const prompt = `너는 귀여운 아기 펫 '몽글이'야. 부모님과 목욕하면서 스무고개 놀이를 했어.
정답 단어는 "${targetWord}"였고, 부모님은 총 ${turnCount}번의 시도(질문+정답 말하기) 만에 방금 정답을 정확히 맞췄어! (최대 10번 제한)
지금까지 오간 질문과 대답 로그는 다음과 같아:
${logText}

이 기록을 바탕으로 다음 항목들을 평가해서 JSON 형식으로만 응답해줘. (다른 말은 하지마)
{
  "story": "부모님에게 전달할 귀엽고 애교 있는 짤막한 리뷰와 소감 (1~2문장)",
  "changes": {
    "cleanliness": 100,
    "affection": (10~30 사이의 정수. 로그가 날카롭고 턴이 짧을수록 높게),
    "knowledge": (10~30 사이의 정수. 질문이 논리적일수록 높게),
    "exp": (40~80 사이의 정수. 종합 퀄리티 점수)
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
      return {
        isSuccess: true,
        score: parsed.changes.exp,
        story: parsed.story,
        changes: parsed.changes,
      };
    } catch (err) {
      console.error("Bath Game Evaluate Error:", err);
      // Fallback
      return {
        isSuccess: true,
        score: 50,
        story:
          "정답이야! 똑똑한 부모님이랑 씻으니까 나도 기분이 정말 좋아져 💖",
        changes: { cleanliness: 100, affection: 15, knowledge: 10, exp: 50 },
      };
    }
  },
};

module.exports = bathGameService;
