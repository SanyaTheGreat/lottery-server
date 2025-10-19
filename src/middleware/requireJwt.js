import jwt from "jsonwebtoken";

/**
 * Обязательная авторизация — если токена нет или он невалидный, возвращаем 401
 */
export function requireJwt() {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    const [, token] = auth.split(" ");
    if (!token) {
      return res.status(401).json({ ok: false, error: "No token" });
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // { telegram_id, username, iat, exp }
      next();
    } catch (e) {
      return res.status(401).json({ ok: false, error: "Bad or expired token" });
    }
  };
}

/**
 * Необязательная авторизация — просто пытаемся прочитать JWT,
 * но если его нет или он невалидный, продолжаем без req.user
 */
export function optionalJwt() {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    const [, token] = auth.split(" ");
    if (!token) return next();

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch {
      // просто игнорируем ошибки токена
    }
    next();
  };
}
