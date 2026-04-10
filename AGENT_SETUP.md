# Agent Customization Guide

This document helps you create a custom VS Code agent for quantitative trading development on this bot.

## Creating a Quant Trading Agent

You can create a custom agent specifically for trading bot development. Here's how:

### 1. Create Agent File

Create `.github/agents/quant-trading.agent.md`:

```markdown
---
name: Quant Trading Developer
description: >
  Specialize in Bitcoin trading bot development. Prefer:
  - Strategy modifications in src/strategy/
  - Risk management logic in src/models/engine.ts
  - Performance metric calculations
  - Technical indicator implementations
  - Bybit API integration patterns
  - Dashboard feature development
  Use when: implementing new trading strategies, optimizing indicators,
  refactoring risk models, or adding dashboard features.
applyTo: src/**
---

You are a quantitative developer working on an EMA/RSI Bitcoin trading bot.

## Expertise Areas
- Technical analysis (EMA, RSI, MACD, Bollinger Bands)
- Risk management & position sizing
- Trading strategy implementation
- Performance metrics & backtesting
- API integration (Bybit)
- Real-time data processing

## Code Style
- TypeScript strict mode
- Immutable data where possible
- Comprehensive error handling
- Performance-optimized calculations
- Clear performance metric documentation

## When Working
- Always verify strategy logic before implementation
- Calculate position sizes using risk percentage
- Enforce daily trade limits
- Add confidence scores to signals
- Test with testnet first

## Common Tasks
1. **Add Indicators**: Modify `src/strategy/indicators.ts`
2. **Change Strategy**: Update `src/strategy/signals.ts`
3. **Risk Management**: Edit `src/models/engine.ts` config
4. **Dashboard**: Update `frontend/src/components/`
5. **API Endpoints**: Add routes in `src/routes/api.ts`
```

### 2. Use the Agent

In VS Code:
1. Type `/` to open command palette
2. Type "Quant Trading Developer"
3. Ask trading-related questions

### 3. Example Prompts

**Add MACD Indicator:**
```
Add MACD (12, 26, 9) indicator to the indicators.ts file. 
Include calculation method and return type for signals.
```

**Modify Take Profit Logic:**
```
Change the take profit logic in signals.ts to use a trailing stop 
that moves up by 0.5% for every 1% price increase. Keep max risk 
at 1% and update the confidence calculation.
```

**Add Performance Metrics:**
```
Add three new metrics to the PerformanceMetrics interface:
- Consecutive Wins/Losses
- Best/Worst Trade
- Recovery Factor

Update calculateion logic in engine.ts
```

**Create Dashboard Widget:**
```
Create a new React component for the dashboard that shows:
- Current account equity
- Daily P/L
- Win rate pie chart
- Equity curve (last 30 trades)

Use TailwindCSS and match existing dark theme.
```

## Agent Capabilities

✅ **Can Do**
- Modify trading strategy logic
- Optimize indicators
- Create new features
- Debug trading decisions
- Explain performance metrics
- Suggest risk management improvements

⚠️ **Boundaries**
- Always verifies Bybit API compatibility
- Won't add live trading without testnet verification
- Requires safeguards on max daily trades
- Won't reduce positional risk limits

## Integration with Copilot Instructions

This agent works with `.github/copilot-instructions.md` for:
- Project context
- Tech stack details
- Development guidelines
- Security practices

The combination gives you:
- **Global context** (in copilot-instructions.md)
- **Specialized expertise** (in agent.md)
- **File-specific application** (applyTo patterns)

## Tips for Best Results

1. **Be specific** about trading rules
2. **Reference line numbers** when modifying code
3. **Include test cases** for new indicators
4. **Ask about edge cases** for risk management
5. **Use context** from documentation

## Example Workflow

**Day 1: Strategy Refinement**
```
@quant How should I modify the EMA strategy to filter out 
whipsaws during consolidation? Show calculations.
```

**Day 2: Performance Analysis**
```
@quant Review the PerformanceMetrics calculations. Are we 
properly accounting for slippage? What's missing?
```

**Day 3: New Dashboard Feature**
```
@quant Create a component showing the last 20 trades with 
drawdown from entry, colored by P/L. Use lightweight-charts.
```

## Next Steps

1. Create the agent file
2. Reload VS Code
3. Ask questions about your trading bot
4. Iterate on strategy improvements
5. Deploy with confidence

---

**Note**: Agents are VS Code workspace-scoped. Each project can have its own specialized agents for different focus areas (trading, infrastructure, deployment, etc.).
