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
   * @returns {Promise<{story: string, score: number}>} 결과
   */
  evaluateResult: (isCorrect, turnCount) => {
    if (!isCorrect) {
      return {
        score: 30,
        story:
          "아쉽게도 정답을 맞히지 못했어. 그래도 깨끗하게 씻고 스무고개 하니까 정말 즐거웠어요! 🐾",
      };
    }

    // 턴수가 적을수록 높은 점수 (최대 100, 최소 50)
    const score = Math.max(50, 100 - (turnCount - 1) * 2.5);
    let story = "";
    if (turnCount <= 5) {
      story =
        "우와! 엄청 빨리 맞히셨네요! 천재 부모님이랑 씻으니까 너무 좋아요 ✨";
    } else if (turnCount <= 15) {
      story =
        "호흡이 척척 맞네요! 재밌게 대화하다 보니까 어느새 다 씻었어요 🛁";
    } else {
      story =
        "휴, 겨우 맞혔네요! 몽글이는 오늘 부모님과 스무고개 해서 너무 행복했어요 🫧";
    }

    return { score: Math.round(score), story };
  },
};

module.exports = bathGameService;
