import logging
import os
import re
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("tradingagents-api")

# Load environment from backend/.env and root .env (root .env takes priority if edited)
backend_env = Path(__file__).with_name(".env")
root_env = Path(__file__).resolve().parent.parent / ".env"
if backend_env.exists():
    load_dotenv(backend_env)
if root_env.exists():
    load_dotenv(root_env, override=True)

from tradingagents.default_config import DEFAULT_CONFIG, build_default_config  # noqa: E402
from tradingagents.graph.trading_graph import TradingAgentsGraph  # noqa: E402

ALLOWED_ANALYSTS = {"market", "social", "news", "fundamentals"}
DEFAULT_ANALYSTS = "market,news,fundamentals"
DEFAULT_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)

origins = [
    origin.strip()
    for origin in os.getenv("TRADINGAGENTS_ALLOWED_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",")
    if origin.strip()
]

app = FastAPI(title="TradingAgents API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalysisRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=10)
    date: date
    analysts: str = DEFAULT_ANALYSTS
    output_language: str = Field(default="English", min_length=1, max_length=40)

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, value: str) -> str:
        ticker = value.strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,9}", ticker):
            raise ValueError("Ticker must be a valid stock symbol.")
        return ticker

    @field_validator("analysts")
    @classmethod
    def validate_analysts(cls, value: str) -> str:
        analysts = [analyst.strip().lower() for analyst in value.split(",") if analyst.strip()]
        if not analysts:
            raise ValueError("At least one analyst must be selected.")
        unsupported = sorted(set(analysts) - ALLOWED_ANALYSTS)
        if unsupported:
            raise ValueError(f"Unsupported analyst(s): {', '.join(unsupported)}.")
        return ",".join(dict.fromkeys(analysts))


@app.get("/health")
def health():
    return {"status": "ok"}


def run_analysis(request: AnalysisRequest) -> dict:
    config = build_default_config() if callable(build_default_config) else DEFAULT_CONFIG.copy()
    config["output_language"] = request.output_language
    selected_analysts = request.analysts.split(",")

    graph = TradingAgentsGraph(
        selected_analysts=selected_analysts,
        debug=False,
        config=config,
    )
    final_state, rating = graph.propagate(request.ticker, request.date.isoformat())

    return {
        "success": True,
        "ticker": request.ticker,
        "date": request.date.isoformat(),
        "decision": rating,
        "analysis": {
            "final_trade_decision": final_state.get("final_trade_decision", ""),
            "market_report": final_state.get("market_report", ""),
            "sentiment_report": final_state.get("sentiment_report", ""),
            "news_report": final_state.get("news_report", ""),
            "fundamentals_report": final_state.get("fundamentals_report", ""),
            "trader_investment_plan": final_state.get("trader_investment_plan", ""),
            "investment_plan": final_state.get("investment_plan", ""),
        },
    }


@app.post("/api/analyze")
@app.post("/api/tradingagents/analyze")
async def analyze(request: AnalysisRequest):
    try:
        return await run_in_threadpool(run_analysis, request)
    except Exception as error:
        logger.exception("TradingAgents analysis failed for %s on %s", request.ticker, request.date)
        raise HTTPException(
            status_code=502,
            detail=f"TradingAgents analysis failed: {error}",
        ) from error
