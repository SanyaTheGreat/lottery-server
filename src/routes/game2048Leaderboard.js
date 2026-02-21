import express from "express";
import { supabase } from "../services/supabaseClient.js";

const router = express.Router();

function clampInt(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function getTelegramId(req) {
  const t = req?.user?.telegram_id ?? req?.user?.telegramId ?? req?.user?.tg_id;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /game2048/leaderboard/week?limit=50
 *
 * top: place 1..N
 * me: позиция текущего пользователя в этом периоде (если есть запись в weekly_scores)
 */
router.get("/leaderboard/week", async (req, res) => {
  const limit = clampInt(req.query.limit, 1, 100, 50);

  const tgId = getTelegramId(req); // нужен для me
  const t0 = Date.now();
  const mark = (label) => console.log(`[2048/lb] ${label} +${Date.now() - t0}ms tg=${tgId ?? "na"}`);

  mark("start");

  try {
    // 1) active period
    const { data: periods, error: pErr } = await supabase
      .from("weekly_periods")
      .select("id,start_at,freeze_at,end_at,status")
      .eq("status", "active")
      .order("start_at", { ascending: false })
      .limit(1);

    mark("after period select");

    if (pErr) {
      console.error("[2048/lb] weekly_periods select error:", pErr.message);
      return res.status(500).json({ ok: false, error: "DB error (weekly_periods)" });
    }

    if (!periods?.length) {
      return res.json({ ok: true, period: null, top: [], me: null });
    }

    const period = periods[0];

    // 2) TOP N for period (place = idx+1)
    const { data: scores, error: sErr } = await supabase
      .from("weekly_scores")
      .select(
        `
        user_id,
        best_score,
        achieved_at,
        users:users (
          username,
          avatar_url
        )
      `
      )
      .eq("period_id", period.id)
      .order("best_score", { ascending: false })
      .order("achieved_at", { ascending: true })
      .limit(limit);

    mark("after top select");

    if (sErr) {
      console.error("[2048/lb] weekly_scores select error:", sErr.message);
      return res.status(500).json({ ok: false, error: "DB error (weekly_scores)" });
    }

    const top = (scores ?? []).map((row, idx) => {
      const u = row.users || {};
      return {
        place: idx + 1,
        user_id: row.user_id,
        username: u.username ?? null,
        avatar_url: u.avatar_url ?? null,
        score: Number(row.best_score ?? 0),
        achieved_at: row.achieved_at ?? null,
      };
    });

    // 3) ME (optional)
    let me = null;

    if (tgId) {
      // 3.1) get my user_id
      const { data: user, error: uErr } = await supabase
        .from("users")
        .select("id,username,avatar_url")
        .eq("telegram_id", tgId)
        .maybeSingle();

      mark("after me user select");

      if (uErr) {
        console.error("[2048/lb] users select error:", uErr.message);
        // не фейлим весь лидерборд — просто не вернём me
      } else if (user?.id) {
        // 3.2) get my weekly_scores row for this period
        const { data: myScoreRow, error: mErr } = await supabase
          .from("weekly_scores")
          .select("user_id,best_score,achieved_at")
          .eq("period_id", period.id)
          .eq("user_id", user.id)
          .maybeSingle();

        mark("after me score select");

        if (mErr) {
          console.error("[2048/lb] me weekly_scores select error:", mErr.message);
        } else if (myScoreRow) {
          const myScore = Number(myScoreRow.best_score ?? 0);
          const myAchievedAt = myScoreRow.achieved_at;

          // rank = count(higher score) + count(same score but earlier achieved_at) + 1
          // (тай на одинаковом achieved_at — редкость; если будет нужно — докрутим)
          const { count: higherCount, error: c1Err } = await supabase
            .from("weekly_scores")
            .select("user_id", { count: "exact", head: true })
            .eq("period_id", period.id)
            .gt("best_score", myScore);

          mark("after me higher count");

          if (c1Err) {
            console.error("[2048/lb] higher count error:", c1Err.message);
          } else {
            let earlierSameCount = 0;

            if (myAchievedAt) {
              const { count: sameEarlier, error: c2Err } = await supabase
                .from("weekly_scores")
                .select("user_id", { count: "exact", head: true })
                .eq("period_id", period.id)
                .eq("best_score", myScore)
                .lt("achieved_at", myAchievedAt);

              mark("after me same-earlier count");

              if (c2Err) {
                console.error("[2048/lb] same-earlier count error:", c2Err.message);
              } else {
                earlierSameCount = Number(sameEarlier ?? 0);
              }
            }

            const rank = Number(higherCount ?? 0) + earlierSameCount + 1;

            me = {
              place: rank,
              user_id: user.id,
              username: user.username ?? null,
              avatar_url: user.avatar_url ?? null,
              score: myScore,
              achieved_at: myAchievedAt ?? null,
            };
          }
        }
      }
    }

    mark("return ok");

    return res.json({
      ok: true,
      period: {
        id: period.id,
        start_at: period.start_at,
        freeze_at: period.freeze_at,
        end_at: period.end_at,
        status: period.status,
      },
      top,
      me,
    });
  } catch (e) {
    console.error("[2048/lb] unexpected:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;