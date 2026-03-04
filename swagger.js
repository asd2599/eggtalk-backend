const swaggerJsDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

// Swagger 명세서 옵션 설정
const options = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "EggTalk API Documentation",
      version: "1.0.0",
      description: "EggTalk 웹 애플리케이션의 백엔드 API 명세서입니다.",
    },
    servers: [
      {
        url: "http://localhost:8000",
        description: "Local Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  // 주석으로 API 명세를 작성할 라우터 파일 경로
  apis: ["./routes/*.js"],
};

const swaggerSpec = swaggerJsDoc(options);

module.exports = { swaggerUi, swaggerSpec };
