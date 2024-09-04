import { DatasetController } from 'chart.js';
import {
  valueOrDefault,
  toFont,
  isNullOrUndef,
  color,
  _measureText,
} from 'chart.js/helpers';
import { toTextLines, validateSizeValue } from './helpers';
import { layout } from './layout';

/**
 * @param {Array<SankeyDataPoint>} data Array of raw data elements
 * @return {Map<string, SankeyNode>}
 */
export function buildNodesFromRawData(data) {
  const nodes = new Map();

  for (let i = 0; i < data.length; i++) {
    const { from, to, flow } = data[i];

    if (!nodes.has(from)) {
      nodes.set(from, {
        key: from,
        in: 0,
        out: flow,
        from: [],
        to: [{ key: to, flow: flow, index: i }],
      });
    } else {
      const node = nodes.get(from);
      node.out += flow;
      node.to.push({ key: to, flow: flow, index: i });
    }

    if (!nodes.has(to)) {
      nodes.set(to, {
        key: to,
        in: flow,
        out: 0,
        from: [{ key: from, flow: flow, index: i }],
        to: [],
      });
    } else {
      const node = nodes.get(to);
      node.in += flow;
      node.from.push({ key: from, flow: flow, index: i });
    }
  }

  const flowSort = (a, b) => b.flow - a.flow;

  [...nodes.values()].forEach((node) => {
    node.from = node.from.sort(flowSort);
    node.from.forEach((x) => {
      x.node = nodes.get(x.key);
    });

    node.to = node.to.sort(flowSort);
    node.to.forEach((x) => {
      x.node = nodes.get(x.key);
    });
  });

  return nodes;
}

/**
 * @param {Array<FromToElement>} arr
 * @param {string} key
 * @param {number} index
 * @return {number}
 */
function getAddY(arr, key, index) {
  for (const item of arr) {
    if (item.key === key && item.index === index) {
      return item.addY;
    }
  }
  return 0;
}

export default class SankeyController extends DatasetController {
  /**
   * @param {ChartMeta<Flow, Element>} meta
   * @param {Array<SankeyDataPoint>} data Array of original data elements
   * @param {number} start
   * @param {number} count
   * @return {Array<SankeyParsedData>}
   */

  parseObjectData(meta, data, start, count) {
    const {
      from: fromKey = 'from',
      to: toKey = 'to',
      flow: flowKey = 'flow',
    } = this.options.parsing;

    const sankeyData = data.map(
      ({ [fromKey]: from, [toKey]: to, [flowKey]: flow }) => ({
        from,
        to,
        flow,
      })
    );
    const { xScale, yScale } = meta;

    const parsed = []; /* Array<SankeyParsedData> */
    const nodes = (this._nodes = buildNodesFromRawData(sankeyData));

    /* getDataset() => SankeyControllerDatasetOptions */
    const { column, priority, size } = this.getDataset();
    if (priority) {
      for (const node of nodes.values()) {
        if (node.key in priority) {
          node.priority = priority[node.key];
        }
      }
    }
    if (column) {
      for (const node of nodes.values()) {
        if (node.key in column) {
          node.column = true;
          node.x = column[node.key];
        }
      }
    }

    const { maxX, maxY } = layout(
      nodes,
      sankeyData,
      !!priority,
      validateSizeValue(size)
    );

    this._maxX = maxX;
    this._maxY = maxY;

    for (let i = 0, ilen = sankeyData.length; i < ilen; ++i) {
      const dataPoint = sankeyData[i];
      const from = nodes.get(dataPoint.from);
      const to = nodes.get(dataPoint.to);
      const fromY = from.y + getAddY(from.to, dataPoint.to, i);
      const toY = to.y + getAddY(to.from, dataPoint.from, i);
      parsed.push({
        x: xScale.parse(from.x, i),
        y: yScale.parse(fromY, i),
        _custom: {
          from,
          to,
          x: xScale.parse(to.x, i),
          y: yScale.parse(toY, i),
          height: yScale.parse(dataPoint.flow, i),
          nodeWidth: valueOrDefault(this.getDataset().nodeWidth, 10),
        },
      });
    }
    return parsed.slice(start, start + count);
  }

  getMinMax(scale) {
    return {
      min: 0,
      max: scale === this._cachedMeta.xScale ? this._maxX : this._maxY,
    };
  }

  update(mode) {
    const { data } = this._cachedMeta;

    this.chart.config.options.padding = {};

    this.updateElements(data, 0, data.length, mode);
  }

  /**
   * @param {Array<Flow>} elems
   * @param {number} start
   * @param {number} count
   * @param {"resize" | "reset" | "none" | "hide" | "show" | "normal" | "active"} mode
   */
  updateElements(elems, start, count, mode) {
    const { xScale, yScale } = this._cachedMeta;
    const firstOpts = this.resolveDataElementOptions(start, mode);
    const sharedOptions = this.getSharedOptions(mode, elems[start], firstOpts);
    const dataset = this.getDataset();
    const borderWidth = valueOrDefault(dataset.borderWidth, 1) / 2 + 0.5;
    const nodeWidth = valueOrDefault(dataset.nodeWidth, 10);

    for (let i = start; i < start + count; i++) {
      /* getParsed(idx: number) => SankeyParsedData */
      const parsed = this.getParsed(i);
      const custom = parsed._custom;
      const y = yScale.getPixelForValue(parsed.y);

      console.log({ parsed });

      const fromKey = parsed._custom.from.key;
      const isLeftEnd = parsed._custom.from.from.length === 0;
      const fromLabel = this.nodeLabels[fromKey];
      const fromLabelPosition = this.labelPositions[fromKey];

      const toKey = parsed._custom.to.key;
      const isRightEnd = parsed._custom.to.to.length === 0;
      const toLabel = this.nodeLabels[toKey];
      const toLabelPosition = this.labelPositions[toKey];

      let movedX = 0;
      let movedX2 = 0;

      if (fromLabel && fromLabelPosition === 'left' && isLeftEnd) {
        movedX =
          this._ctx.measureText(fromLabel).width + nodeWidth / 2 + borderWidth;
      }

      if (toLabel && toLabelPosition === 'right' && isRightEnd) {
        movedX2 =
          -this._ctx.measureText(toLabel).width - nodeWidth / 2 - borderWidth;
      }

      this.updateElement(
        elems[i],
        i,
        {
          x:
            xScale.getPixelForValue(parsed.x) +
            nodeWidth +
            borderWidth +
            movedX,
          y,
          x2: xScale.getPixelForValue(custom.x) - borderWidth + movedX2,
          y2: yScale.getPixelForValue(custom.y),
          from: custom.from,
          to: custom.to,
          progress: mode === 'reset' ? 0 : 1,
          height: Math.abs(
            yScale.getPixelForValue(parsed.y + custom.height) - y
          ),
          options: this.resolveDataElementOptions(i, mode),
        },
        mode
      );
    }

    this.updateSharedOptions(sharedOptions, mode);
  }

  /**
   * @returns {Record<string, CanvasPattern>}
   */

  mapNodeSettingBySettingKey(optionKey) {
    const nodeSettings = this.getDataset().nodeSettings;
    if (nodeSettings) {
      const mappings = Object.entries(nodeSettings).reduce(
        (acc, [key, value]) => {
          acc[key] = value[optionKey] || null;
          return acc;
        },
        {}
      );
      return mappings;
    }

    return {};
  }

  get nodePatterns() {
    return this.mapNodeSettingBySettingKey('pattern');
  }

  get nodeLabels() {
    return this.mapNodeSettingBySettingKey('label');
  }

  get nodeColors() {
    return this.mapNodeSettingBySettingKey('color');
  }

  get labelPositions() {
    return this.mapNodeSettingBySettingKey('labelPosition');
  }

  _drawLabels() {
    const ctx = this._ctx;
    const nodes = this._nodes || new Map();
    const dataset = this.getDataset(); /* SankeyControllerDatasetOptions */
    const size = validateSizeValue(dataset.size);
    const borderWidth = valueOrDefault(dataset.borderWidth, 1);
    const nodeWidth = valueOrDefault(dataset.nodeWidth, 10);
    const labels = this.nodeLabels;
    const { xScale, yScale } = this._cachedMeta;

    ctx.save();
    const chartArea = this.chart.chartArea;
    for (const node of nodes.values()) {
      const x = xScale.getPixelForValue(node.x);
      const y = yScale.getPixelForValue(node.y);

      const max = Math[size](node.in || node.out, node.out || node.in);
      const height = Math.abs(yScale.getPixelForValue(node.y + max) - y);
      const label = (labels && labels[node.key]) || node.key;
      let textX = x;
      let textY = y;

      ctx.fillStyle =
        color(this.nodeColors[node.key]).darken(0.4).hexString() ||
        dataset.color ||
        'black';
      ctx.textBaseline = 'middle';

      const labelPosition = this.labelPositions[node.key];

      switch (labelPosition) {
        case 'left':
          {
            if (node.from.length === 0) {
              ctx.textAlign = 'left';
            } else {
              ctx.textAlign = 'right';
              textX -= borderWidth + 4;
            }
          }
          break;
        case 'right':
          {
            if (node.to.length === 0) {
              ctx.textAlign = 'right';
              textX += nodeWidth + borderWidth;
            } else {
              ctx.textAlign = 'left';
              textX += nodeWidth + borderWidth + 4;
            }
          }
          break;
        case 'top':
          {
            ctx.textAlign = 'center';
            textX += nodeWidth / 2;
            textY -= height / 2 + borderWidth + 8;
          }
          break;
        default: {
          if (x < chartArea.width / 2) {
            ctx.textAlign = 'left';
            textX += nodeWidth + borderWidth + 4;
          } else {
            ctx.textAlign = 'right';
            textX -= borderWidth + 4;
          }
        }
      }

      this._drawLabel(label, textY, height, ctx, textX);
    }
    ctx.restore();
  }

  /**
   * @param {string} label
   * @param {number} y
   * @param {number} height
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} textX
   * @private
   */
  _drawLabel(label, y, height, ctx, textX) {
    const font = toFont(this.options.font, this.chart.options.font);
    const lines = isNullOrUndef(label) ? [] : toTextLines(label);
    const linesLength = lines.length;
    const middle = y + height / 2;
    const textHeight = font.lineHeight;
    const padding = valueOrDefault(this.options.padding, textHeight / 2);

    ctx.font = font.string;

    if (linesLength > 1) {
      const top = middle - (textHeight * linesLength) / 2 + padding;
      for (let i = 0; i < linesLength; i++) {
        ctx.fillText(lines[i], textX, top + i * textHeight);
      }
    } else {
      ctx.fillText(label, textX, middle);
    }
  }

  _drawNodes() {
    const ctx = this._ctx;
    const nodes = this._nodes || new Map();

    const dataset = this.getDataset(); /* SankeyControllerDatasetOptions */
    const size = validateSizeValue(dataset.size);
    const { xScale, yScale } = this._cachedMeta;
    const borderWidth = valueOrDefault(dataset.borderWidth, 1);
    const nodeWidth = valueOrDefault(dataset.nodeWidth, 10);

    ctx.save();
    ctx.strokeStyle = dataset.borderColor || 'black';
    ctx.lineWidth = borderWidth;

    for (const node of nodes.values()) {
      const x = xScale.getPixelForValue(node.x);
      const y = yScale.getPixelForValue(node.y);

      const max = Math[size](node.in || node.out, node.out || node.in);

      const height = Math.abs(yScale.getPixelForValue(node.y + max) - y);

      console.log({ max, height, y });

      const pattern = this.nodePatterns[node.key];
      const nodeLabel = this.nodeLabels[node.key];
      const nodeLabelPosition = this.labelPositions[node.key];

      const nodeLabelWidth = nodeLabel ? ctx.measureText(nodeLabel).width : 0;

      let nodeX = x;

      if (nodeLabel && nodeLabelPosition === 'left' && node.from.length === 0) {
        nodeX += nodeLabelWidth + nodeWidth / 4 + borderWidth;
      }

      if (nodeLabel && nodeLabelPosition === 'right' && node.to.length === 0) {
        nodeX -= nodeLabelWidth + nodeWidth / 8 + borderWidth;
      }

      ctx.beginPath();

      ctx.fillStyle = pattern || node.color;

      if (borderWidth) {
        ctx.roundRect(nodeX, y, nodeWidth, height, 20);
      }
      ctx.roundRect(nodeX, y, nodeWidth, height, 20);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * That's where the drawing process happens
   */
  
  draw() {
    const ctx = this._ctx;
    const data = this.getMeta().data || []; /* Array<Flow> */

    // Set node colors
    const active = [];
    for (let i = 0, ilen = data.length; i < ilen; ++i) {
      const flow = data[i]; /* Flow at index i */

      flow.from.color =
        this.nodeColors[flow.from.key] || flow.options.colorFrom;
      flow.to.color = this.nodeColors[flow.to.key] || flow.options.colorTo;
      if (flow.active) {
        active.push(flow);
      }
    }
    // Make sure nodes connected to hovered flows are using hover colors.
    for (const flow of active) {
      flow.from.color =
        this.nodeColors[flow.from.key] || flow.options.colorFrom;
      flow.to.color = this.nodeColors[flow.to.key] || flow.options.colorTo;
    }

    /* draw Flow elements on the canvas */
    for (let i = 0, ilen = data.length; i < ilen; ++i) {
      data[i].draw(ctx);
    }

    /* draw SankeyNodes on the canvas */
    this._drawNodes();

    /* draw labels (for SankeyNodes) on the canvas */
    this._drawLabels();
  }
}

SankeyController.id = 'sankey';

SankeyController.defaults = {
  dataElementType: 'flow',
  animations: {
    numbers: {
      type: 'number',
      properties: ['x', 'y', 'x2', 'y2', 'height'],
    },
    progress: {
      easing: 'linear',
      duration: (ctx) =>
        ctx.type === 'data'
          ? (ctx.parsed._custom.x - ctx.parsed.x) * 200
          : undefined,
      delay: (ctx) =>
        ctx.type === 'data'
          ? ctx.parsed.x * 500 + ctx.dataIndex * 20
          : undefined,
    },
    colors: {
      type: 'color',
      properties: ['colorFrom', 'colorTo'],
    },
  },
  transitions: {
    hide: {
      animations: {
        colors: {
          type: 'color',
          properties: ['colorFrom', 'colorTo'],
          to: 'transparent',
        },
      },
    },
    show: {
      animations: {
        colors: {
          type: 'color',
          properties: ['colorFrom', 'colorTo'],
          from: 'transparent',
        },
      },
    },
  },
};

SankeyController.overrides = {
  interaction: {
    mode: 'nearest',
    intersect: true,
  },
  datasets: {
    clip: false,
    parsing: true,
  },
  plugins: {
    tooltip: {
      callbacks: {
        title() {
          return '';
        },
        label(context) {
          const item = context.dataset.data[context.dataIndex];
          return item.from + ' -> ' + item.to + ': ' + item.flow;
        },
      },
    },
    legend: {
      display: false,
    },
  },
  scales: {
    x: {
      type: 'linear',
      bounds: 'data',
      display: false,
      min: 0,
      offset: false,
    },
    y: {
      type: 'linear',
      bounds: 'data',
      display: false,
      min: 0,
      reverse: true,
      offset: false,
    },
  },
  layout: {
    padding: {
      top: 3,
      left: 3,
      bottom: 3,
    },
  },
};
