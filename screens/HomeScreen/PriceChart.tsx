import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Pressable } from 'react-native';

import rektBomb from '@/assets/images/app-pngs/rekt-bomb.png';
import FlagIcon from '@/assets/images/app-svgs/flag.svg';
import {
  BodyXSEmphasized,
  BodyXSMonoEmphasized,
  PulsatingContainer,
} from '@/components';
import { Trade, useHomeContext } from '@/contexts';
import { isolatedLiq, pnlTicks, viewportFor, yDecimals } from '@/utils';
import {
  calculatePriceChange,
  getCurrentPriceFromHistorical,
  SupportedTimeframe,
  SupportedToken,
  useHistoricalDataQuery,
} from '@/utils';

import { EmojiContainer } from './EmojiContainer';
import { FloatingEmoji } from './FloatingEmoji';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'react-native-gifted-charts';
import styled, { DefaultTheme, useTheme } from 'styled-components/native';
import { View } from 'react-native';

// TODO - overflow hidden problems - rule lines go too far right and top is cut off

export const PriceChart = ({
  showLiquidation = false,
  trade = null,
  dummyData,
}: {
  showLiquidation?: boolean;
  trade?: Trade | null;
  dummyData?: { value: number; timestamp: number }[];
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const chartHeight = 200;
  const {
    selectedToken,
    selectedTimeframe,
    tokenPrices,
    openPositions,
    solTrade,
    ethTrade,
    btcTrade,
  } = useHomeContext();

  // Fetch historical chart data only if no dummy data is provided
  const {
    data: historicalData,
    isLoading: isChartLoading,
    error: chartError,
  } = useHistoricalDataQuery(
    selectedToken as SupportedToken,
    selectedTimeframe as SupportedTimeframe
  );

  // Floating emoji reactions state
  const [reactions, setReactions] = useState<{ id: string; emoji: string }[]>(
    []
  );
  const [isAnimating, setIsAnimating] = useState(false);

  // Handler to add a new floating emoji
  const handleEmojiReaction = (emoji: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setReactions((prev) => [...prev, { id, emoji }]);
    setIsAnimating(true);
  };

  // Use dummy data if provided, otherwise use real data or fallback to loading state
  const data = dummyData || historicalData || [];
  const chartWidth = Dimensions.get('window').width * 0.9 - 8;

  const dataValues = data.map((item: { value: number }) => item.value);

  // Get current price from real-time data or historical data
  const currentPrice =
    tokenPrices?.[selectedToken as SupportedToken]?.current_price ||
    getCurrentPriceFromHistorical(data);

  // Calculate price change percentage
  const { changePercent } = calculatePriceChange(data);

  // Find current position for this token to get real PnL
  const currentPosition = openPositions.find((position) => {
    const tokenMap = { sol: 'SOL-PERP', eth: 'ETH-PERP', btc: 'BTC-PERP' };
    return position.asset === tokenMap[selectedToken as keyof typeof tokenMap];
  });

  // Get liquidation price from real position data only
  const liquidationPrice = currentPosition?.liquidationPrice;

  // Use real entry price from backend position, fallback to trade state
  const entryPrice = currentPosition?.entryPrice || trade?.entryPrice || 0;

  // Determine display leverage (pre-trade from slider trade, post-trade from position)
  const currentTrade = useMemo(() => {
    switch (selectedToken) {
      case 'sol':
        return solTrade;
      case 'eth':
        return ethTrade;
      case 'btc':
        return btcTrade;
      default:
        return solTrade;
    }
  }, [selectedToken, solTrade, ethTrade, btcTrade]);

  const isPostTrade = !!currentPosition || (trade && trade.status === 'open');
  const displayLeverageRaw = isPostTrade
    ? currentPosition?.leverage || trade?.leverage || 1
    : currentTrade?.leverage || 1;
  const displayLeverage = Math.max(1, Math.min(displayLeverageRaw, 500));
  const side: 'long' | 'short' = (isPostTrade
    ? currentPosition?.direction
    : currentTrade?.side || trade?.side) as 'long' | 'short' || 'short';

  // Anchor logic: pre-trade anchor is current price, post-trade anchor follows entry with hysteresis
  const [centerAnchor, setCenterAnchor] = useState<number | null>(null);
  useEffect(() => {
    if (isPostTrade && entryPrice > 0) {
      setCenterAnchor(entryPrice);
    } else {
      setCenterAnchor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPostTrade, entryPrice]);

  const anchor = isPostTrade ? (centerAnchor ?? (entryPrice || currentPrice)) : currentPrice;

  // Viewport computation based on leverage lens
  const pnlSpan = 1.2;
  const minBandBps = 4;
  const { yMin, yMax } = viewportFor({
    anchor,
    leverage: displayLeverage,
    pnlSpan,
    minBandBps,
  });
  const range = yMax - yMin;

  // Calculate positions for different price lines using leverage lens viewport
  const calculateLinePosition = (price: number) => {
    const priceRatio = (price - yMin) / range;
    const topOffset = 20;
    const bottomOffset = 20;
    const plotArea = chartHeight - topOffset - bottomOffset;
    return topOffset + plotArea * (1 - priceRatio);
  };

  // Liquidation logic: actual post-trade, projected pre-trade
  const DEFAULT_MMR = 0.005; // 0.5% default, replace with backend per tier when available
  const gatingOk = 1 / displayLeverage >= DEFAULT_MMR;
  const projectedLiq = !isPostTrade && gatingOk
    ? isolatedLiq({ entry: currentPrice, leverage: displayLeverage, side, mmr: DEFAULT_MMR })
    : null;
  const liqToShow = isPostTrade ? liquidationPrice : projectedLiq || undefined;
  const liquidationLineTop = liqToShow ? calculateLinePosition(liqToShow) : 0;
  const currentPriceLineTop = calculateLinePosition(currentPrice);
  const entryPriceLineTop = entryPrice ? calculateLinePosition(entryPrice) : 0;

  // Only show profit/loss styling when there's an actual open position or open trade
  const hasOpenTrade = (trade && trade.status === 'open') || currentPosition;

  // Determine if position is in profit or loss
  const isProfit = hasOpenTrade
    ? currentPosition
      ? currentPosition.pnl >= 0
      : trade && trade.status === 'open'
      ? (trade.side === 'long' && currentPrice > trade.entryPrice) ||
        (trade.side === 'short' && currentPrice < trade.entryPrice)
      : null
    : null;

  // Set chart color - only apply profit/loss colors when there's an open trade/position
  let chartColor = theme.colors.tint;
  let fillColor = theme.colors.tint;
  if (hasOpenTrade && isProfit !== null) {
    if (isProfit === true) {
      chartColor = theme.colors.profit;
      fillColor = theme.colors.profit;
    } else if (isProfit === false) {
      chartColor = theme.colors.loss;
      fillColor = theme.colors.loss;
    }
  }

  // Hysteresis recentering: recenters when price approaches edges (>=85% of half-range)
  useEffect(() => {
    if (!isPostTrade) return;
    const half = range / 2;
    if (half <= 0) return;
    const delta = Math.abs(currentPrice - anchor);
    if (delta >= 0.85 * half) {
      // Soft recenter: jump center for now; can animate with Reanimated/Skia later
      setCenterAnchor(currentPrice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrice, isPostTrade, range, anchor]);

  // Toggle state for price/percentage view
  const [showPercent, setShowPercent] = useState(false);

  // Show loading state if data is not available and no dummy data is provided
  if ((!dummyData && isChartLoading) || data.length === 0) {
    return (
      <Wrapper>
        <ChartContainer
          style={{
            height: chartHeight,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <BodyXSEmphasized style={{ color: theme.colors.textSecondary }}>
            {t('Loading chart data...')}
          </BodyXSEmphasized>
        </ChartContainer>
      </Wrapper>
    );
  }

  // Show error state only if no dummy data is provided
  if (!dummyData && chartError) {
    return (
      <Wrapper>
        <ChartContainer
          style={{
            height: chartHeight,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <BodyXSEmphasized style={{ color: theme.colors.textSecondary }}>
            {t('Failed to load chart data')}
          </BodyXSEmphasized>
        </ChartContainer>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <ChartContainer>
        <LineChart
          data={data}
          isAnimated
          animationDuration={300}
          areaChart
          color={chartColor}
          thickness={2}
          startFillColor={fillColor}
          endFillColor={theme.colors.background}
          startOpacity={0.2}
          endOpacity={0.01}
          hideDataPoints
          yAxisColor='transparent'
          xAxisColor='transparent'
          rulesColor={theme.colors.secondary}
          noOfSections={4}
          backgroundColor='transparent'
          initialSpacing={0}
          yAxisOffset={yMin}
          width={chartWidth}
          height={chartHeight}
          hideYAxisText={true}
          adjustToWidth={false}
          parentWidth={chartWidth}
          stepHeight={chartHeight / 4}
          stepValue={range / 4}
        />

        {/* Current price line */}
        <LiquidationLineContainer
          style={{
            top: currentPriceLineTop,
            width: chartWidth - 80,
          }}
        >
          <CurrentLine />
        </LiquidationLineContainer>

        {/* Custom y-axis labels (now pressable as a group) */}
        <Pressable
          onPress={() => setShowPercent((prev) => !prev)}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 80,
            height: chartHeight,
          }}
          accessibilityRole='button'
          accessibilityLabel='Toggle price/percentage'
        >
          {Array.from({ length: 5 }, (_, i) => {
            const value = yMin + (range * i) / 4;
            const sectionHeight = (chartHeight - 40) / 4;
            const yPosition = 20 + (4 - i) * sectionHeight;
            const symbol = selectedToken.toUpperCase() as 'SOL' | 'ETH' | 'BTC';
            const decimals = yDecimals(symbol);
            return (
              <YAxisLabel
                key={i}
                style={{
                  top: yPosition,
                  right: 5,
                }}
              >
                <BodyXSMonoEmphasized
                  style={{ color: theme.colors.textSecondary }}
                >
                  ${value.toLocaleString('en-US', {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                  })}
                </BodyXSMonoEmphasized>
              </YAxisLabel>
            );
          })}
        </Pressable>

        {/* PnL gridlines at ±25%, ±50%, ±100% */}
        {pnlTicks({ anchor, leverage: displayLeverage, span: 1 }).map((tick, idx) => {
          const top = calculateLinePosition(tick.price);
          const label = `${tick.pnlPct > 0 ? '+' : ''}${tick.pnlPct}% PnL → $${tick.price.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;
          return (
            <LiquidationLineContainer
              key={`pnl-${idx}`}
              style={{ top, width: chartWidth - 80 }}
            >
              <GuideLine />
              <GuideLabel
                style={{ right: 15, top: -10 }}
              >
                <BodyXSMonoEmphasized style={{ color: theme.colors.textSecondary }}>
                  {label}
                </BodyXSMonoEmphasized>
              </GuideLabel>
            </LiquidationLineContainer>
          );
        })}

        <CurrentPriceLabel
          style={{
            top: currentPriceLineTop - 12,
            right: 15,
          }}
        >
          <CurrentPriceBubble $isProfit={hasOpenTrade ? isProfit : null}>
            <CurrentPriceText style={{ color: theme.colors.background }}>
              {/* Toggle between price and PnL percentage */}
              {showPercent && currentPosition
                ? currentPosition.pnl >= 0
                  ? `+${currentPosition.pnlPercentage.toFixed(2)}%`
                  : `${currentPosition.pnlPercentage.toFixed(2)}%`
                : showPercent && !currentPosition
                ? `${changePercent.toFixed(2)}%`
                : `$${currentPrice.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
            </CurrentPriceText>
          </CurrentPriceBubble>
        </CurrentPriceLabel>

        {/* Entry Price Line and Label (show only if there's an open position or open trade) */}
        {hasOpenTrade && entryPrice > 0 && (
          <>
            <LiquidationLineContainer
              style={{
                top: entryPriceLineTop,
                width: chartWidth - 80,
              }}
            >
              <EntryLine />
            </LiquidationLineContainer>
            <EntryPriceLabel
              style={{
                top: entryPriceLineTop - 10,
                right: 15,
              }}
            >
              <EntryPriceBubble>
                <FlagIcon />
                <EntryPriceText style={{ color: theme.colors.textPrimary }}>
                  $
                  {entryPrice.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </EntryPriceText>
              </EntryPriceBubble>
            </EntryPriceLabel>
          </>
        )}

        {/* Liquidation Line, Label, and Bomb Band */}
        {showLiquidation && liqToShow && (
          <>
            {/* Bomb warning band from liq to edge (direction depends on side) */}
            <WarningBand
              style={{
                top:
                  side === 'long'
                    ? liquidationLineTop
                    : 20,
                height:
                  side === 'long'
                    ? Math.max(0, chartHeight - 20 - liquidationLineTop)
                    : Math.max(0, liquidationLineTop - 20),
                width: chartWidth - 80,
              }}
            />
            <LiquidationLineContainer
              style={{
                top: liquidationLineTop,
                width: chartWidth - 80,
              }}
            >
              <PulsatingContainer
                duration={1000}
                style={{ position: 'absolute', top: -14, left: 0, zIndex: 20 }}
              >
                <Image source={rektBomb} style={{ width: 30, height: 30 }} />
              </PulsatingContainer>
              <LiquidationLine />
            </LiquidationLineContainer>

            <LiquidationLabel
              style={{
                top: liquidationLineTop - 10,
                right: 15,
              }}
            >
              <LiquidationText style={{ color: theme.colors.textPrimary }}>
                $
                {liqToShow.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </LiquidationText>
            </LiquidationLabel>
          </>
        )}
        {trade && trade.status === 'open' && (
          <EmojiContainer
            onEmojiPress={handleEmojiReaction}
            isAnimating={isAnimating}
          />
        )}
        {/* Floating emoji reactions */}
        {reactions.map(({ id, emoji }) => (
          <FloatingEmoji
            key={id}
            emoji={emoji}
            chartHeight={chartHeight}
            onDone={() => {
              setReactions((prev) => prev.filter((r) => r.id !== id));
              setIsAnimating(false);
            }}
          />
        ))}
      </ChartContainer>
    </Wrapper>
  );
};

const Wrapper = styled.View`
  align-items: center;
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.background};
  border-radius: 16px;
  padding: 16px;
`;

const ChartContainer = styled.View`
  position: relative;
  /* overflow: hidden; */
`;

const YAxisLabel = styled.View`
  position: absolute;
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.background}80;
  padding: 2px 6px;
  border-radius: 2px;
  z-index: 12;
  min-width: 70px;
  align-items: center;
`;

const CurrentPriceLabel = styled.View`
  position: absolute;
  z-index: 20;
`;

const CurrentPriceBubble = styled.View<{ $isProfit: boolean | null }>`
  padding: 4px 8px;
  border-radius: 12px;
  background-color: ${({
    theme,
    $isProfit,
  }: {
    theme: DefaultTheme;
    $isProfit: boolean | null;
  }) =>
    $isProfit === true
      ? theme.colors.profit
      : $isProfit === false
      ? theme.colors.loss
      : theme.colors.tint};
`;

const CurrentPriceText = styled.Text`
  font-size: 11px;
  font-weight: 600;
  font-family: 'Geist Mono';
`;

// Entry Price Styles
const EntryPriceLabel = styled.View`
  position: absolute;
  z-index: 16;
`;

const EntryPriceBubble = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.borderEmphasized};
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.background};
`;

const EntryPriceText = styled.Text`
  font-size: 11px;
  font-weight: 500;
  font-family: 'Geist Mono';
`;

// Liquidation Styles (existing)
const LiquidationLineContainer = styled.View`
  position: absolute;
  flex: 1;
  flex-direction: row;
  justify-content: flex-end;
  align-items: flex-start;
  margin-left: 20px;
`;

const LiquidationLine = styled.View`
  flex: 1;
  height: 1px;
  border-width: 1px;
  border-style: dashed;
  border-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.liquidBorder};
  z-index: 10;
`;

// Additional guide/entry/current/warner styles
const GuideLine = styled.View`
  flex: 1;
  height: 1px;
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.borderLight};
  opacity: 0.35;
`;

const GuideLabel = styled.View`
  position: absolute;
  padding: 2px 6px;
  border-radius: 8px;
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.background}CC;
  z-index: 12;
`;

const EntryLine = styled.View`
  flex: 1;
  height: 1px;
  border-width: 1px;
  border-style: dotted;
  border-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.borderEmphasized};
  z-index: 12;
`;

const CurrentLine = styled.View`
  flex: 1;
  height: 1px;
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.textSecondary};
  opacity: 0.5;
  z-index: 11;
`;

const WarningBand = styled.View`
  position: absolute;
  left: 20px;
  right: 60px;
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.liquidBg};
  opacity: 0.15;
  z-index: 5;
`;

const LiquidationLabel = styled.View`
  position: absolute;
  padding: 2px 6px;
  border-radius: 12px;
  border-width: 1px;
  border-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.liquidBorder};
  background-color: ${({ theme }: { theme: DefaultTheme }) =>
    theme.colors.liquidBg};
  z-index: 13;
`;

const LiquidationText = styled.Text`
  font-size: 12px;
  font-weight: 500;
  font-family: 'Geist Mono';
`;
