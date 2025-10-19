import jwt from "jsonwebtoken";

export function requireJwt() {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    const [, token] = auth.split(" ");
    if (!token) return res.status(401).json({ ok: false, error: "No token" });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // { telegram_id, username, iat, exp }
      next();
    } catch (e) {
      return res.status(401).json({ ok: false, error: "Bad or expired token" });
    }
  };
}
