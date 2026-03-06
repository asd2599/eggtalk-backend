const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res
      .status(401)
      .json({ message: "인증 토큰이 제공되지 않았습니다." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decodedUser) => {
    if (err) {
      console.error("JWT Verification Error:", err.message);
      // 토큰 만료 시와 유효하지 않은 경우를 구분해서 로그 남김
      return res.status(403).json({
        message: "유효하지 않은 토큰입니다.",
        error: err.message,
        expired: err.name === "TokenExpiredError",
      });
    }

    // decodedUser 에는 userController 로긴시 서명된 { userId, email } 가 들어있습니다
    req.user = decodedUser;

    // petController 에서는 req.user.id 로 쓰게 작성해두었기 때문에 필드명을 맞춥니다
    req.user.id = decodedUser.userId;

    next();
  });
};

module.exports = { authenticateToken };
