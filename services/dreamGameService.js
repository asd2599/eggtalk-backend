/**
 * dreamGameService.js
 * AI 꿈나라 모험 협동 게임 전용 AI 서비스
 */

const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * AI가 꿈나라의 전반적인 테마와 힌트를 생성합니다.
 * @returns {Promise<string>} 힌트 문자열
 */
const generateDreamHint = async () => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "너는 아기들을 꿈나라로 인도하는 '꿈의 요정'이야. 아기가 오늘 밤 어떤 환상적인 꿈을 꾸고 싶어하는지 아주 짧고 매혹적인 힌트를 한 문장으로 줘. 예: '반짝이는 별가루가 쏟아지는 밤하늘을 날고 싶대요!', '폭신폭신한 솜사탕 구름 뒤에 보물이 숨겨져 있대요!'",
        },
      ],
      max_tokens: 100,
      temperature: 0.9,
    });
    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("AI Dream Hint Error:", err);
    return "아름다운 꿈나라 모험이 아기를 기다리고 있어요!";
  }
};

/**
 * 부모들이 고른 장소와 행동을 바탕으로 AI가 이야기를 생성하고 평가합니다.
 * @param {string} hint - 처음에 주어진 힌트
 * @param {Object} choices - { place: string, guide: string }
 * @returns {Promise<{score: number, story: string, healthHp: number, exp: number, affection: number, hunger: string}>} 결과 데이터
 */
const createDreamStory = async (hint, choices) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `너는 꿈의 해석가야. 부모가 선택한 꿈의 요소들을 엮어 아기를 위한 짧고 아름다운 꿈 이야기를 만들어줘.
          
          오늘의 힌트: "${hint}"
          꿈의 장소: "${choices.place}"
          함께할 친구/행동: "${choices.guide}"
          
          위 요소들을 활용해 아기가 꿈에서 겪는 환상적인 모험을 3문장 이내로 작성해줘. 
          또한 이 모험이 아기에게 준 긍정적인 영향(애정도, 건강, 경험치 상승 등)을 수치화해줘.
          
          반드시 JSON 형식으로 응답해:
          {
            "score": 95,
            "story": "우와! 아기가 별빛 바다에서 보석 고래를 타고 끝없는 우주를 여행했어요. 고래의 배꼽을 간지럽히며 아기는 정말 행복한 웃음을 터뜨렸답니다!",
            "changes": {
              "healthHp": 15,
              "exp": 20,
              "affection": 25,
              "hunger": "포만감이 유지됩니다"
            }
          }`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error("AI Dream Evaluation Error:", err);
    return {
      score: 80,
      story: "아기는 부모님이 만들어준 꿈속에서 아주 행복한 시간을 보냈답니다.",
      changes: {
        healthHp: 10,
        exp: 10,
        affection: 10,
        hunger: "평온함"
      }
    };
  }
};

module.exports = {
  generateDreamHint,
  createDreamStory,
};
