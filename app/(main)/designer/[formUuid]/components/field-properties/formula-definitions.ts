
/**
 * 字段公式函数定义
 * */
import type { FunctionGroup } from "shuttle-formula/render";

export const FORMULA_FUNCTION_GROUPS: FunctionGroup[] = [
  {
    id: "text",
    label: "文本函数",
    functions: {
      CONCATENATE: {
        label: "拼接文本",
        description: "合并多个文本或数字",
        params: [
          {
            define: [
              { type: "string" },
              { type: "number" },
              { type: "boolean" },
            ],
          },
        ],
        loopAfterParams: 1,
        return: { type: "string" },
      },
      LEN: {
        label: "长度",
        description: "返回文本或数组长度",
        params: [{ define: [{ type: "string" }, { type: "array" }] }],
        return: { type: "number" },
      },
      TRIM: {
        label: "去除空格",
        description: "去除文本首尾空格",
        params: [{ define: { type: "string" } }],
        return: { type: "string" },
      },
      LOWER: {
        label: "转小写",
        description: "将文本转换为小写",
        params: [{ define: { type: "string" } }],
        return: { type: "string" },
      },
      UPPER: {
        label: "转大写",
        description: "将文本转换为大写",
        params: [{ define: { type: "string" } }],
        return: { type: "string" },
      },
      LEFT: {
        label: "左侧截取",
        description: "从左侧截取指定长度",
        params: [{ define: { type: "string" } }, { define: { type: "number" } }],
        return: { type: "string" },
      },
      RIGHT: {
        label: "右侧截取",
        description: "从右侧截取指定长度",
        params: [{ define: { type: "string" } }, { define: { type: "number" } }],
        return: { type: "string" },
      },
      MID: {
        label: "中间截取",
        description: "从指定位置截取文本",
        params: [{ define: { type: "string" } }, { define: { type: "number" } }, { define: { type: "number" } }],
        return: { type: "string" },
      },
      REPLACE: {
        label: "替换文本",
        description: "替换文本中的指定内容",
        params: [{ define: { type: "string" } }, { define: { type: "string" } }, { define: { type: "string" } }],
        return: { type: "string" },
      },
      TEXT: {
        label: "转文本",
        description: "将值转换为文本",
        params: [{ forwardInput: true }],
        return: { type: "string" },
      },
      VALUE: {
        label: "转数字",
        description: "将文本转换为数字",
        params: [{ define: { type: "string" } }],
        return: { type: "number" },
      },
    },
  },
  {
    id: "number",
    label: "数学函数",
    functions: {
      SUM: {
        label: "求和",
        description: "计算多个数字的总和",
        params: [{ define: { type: "number" } }],
        loopAfterParams: 1,
        return: { type: "number" },
      },
      AVERAGE: {
        label: "平均值",
        description: "计算多个数字的平均值",
        params: [{ define: { type: "number" } }],
        loopAfterParams: 1,
        return: { type: "number" },
      },
      MIN: {
        label: "最小值",
        description: "返回多个数字中的最小值",
        params: [{ define: { type: "number" } }],
        loopAfterParams: 1,
        return: { type: "number" },
      },
      MAX: {
        label: "最大值",
        description: "返回多个数字中的最大值",
        params: [{ define: { type: "number" } }],
        loopAfterParams: 1,
        return: { type: "number" },
      },
      ROUND: {
        label: "四舍五入",
        description: "返回四舍五入后的数字",
        params: [{ define: { type: "number" } }],
        return: { type: "number" },
      },
      ABS: {
        label: "绝对值",
        description: "返回数字的绝对值",
        params: [{ define: { type: "number" } }],
        return: { type: "number" },
      },
      CEIL: {
        label: "向上取整",
        description: "返回大于等于当前值的整数",
        params: [{ define: { type: "number" } }],
        return: { type: "number" },
      },
      FLOOR: {
        label: "向下取整",
        description: "返回小于等于当前值的整数",
        params: [{ define: { type: "number" } }],
        return: { type: "number" },
      },
      POWER: {
        label: "乘方",
        description: "返回指定数字的乘方结果",
        params: [{ define: { type: "number" } }, { define: { type: "number" } }],
        return: { type: "number" },
      },
      MOD: {
        label: "取余",
        description: "返回两个数字相除的余数",
        params: [{ define: { type: "number" } }, { define: { type: "number" } }],
        return: { type: "number" },
      },
      SQRT: {
        label: "平方根",
        description: "返回数字的平方根",
        params: [{ define: { type: "number" } }],
        return: { type: "number" },
      },
      RANDOM: {
        label: "随机数",
        description: "返回 0 到 1 之间的随机数",
        params: [],
        return: { type: "number" },
      },
    },
  },
  {
    id: "date",
    label: "时间函数",
    functions: {
      DATE: {
        label: "创建日期",
        description: "根据年、月、日创建日期",
        params: [
          { define: { type: "number" } },
          { define: { type: "number" } },
          { define: { type: "number" } },
        ],
        return: { type: "string" },
      },
      TODAY: {
        label: "今天",
        description: "返回当前日期",
        params: [],
        return: { type: "string" },
      },
      NOW: {
        label: "当前时间",
        description: "返回当前日期时间",
        params: [],
        return: { type: "string" },
      },
      DATEDIF: {
        label: "日期差",
        description: "计算两个日期之间的差值",
        params: [
          { define: { type: "string" } },
          { define: { type: "string" } },
          { define: { type: "string" } },
        ],
        return: { type: "number" },
      },
      YEAR: {
        label: "年份",
        description: "返回日期中的年份",
        params: [{ define: { type: "string" } }],
        return: { type: "number" },
      },
      MONTH: {
        label: "月份",
        description: "返回日期中的月份",
        params: [{ define: { type: "string" } }],
        return: { type: "number" },
      },
      DAY: {
        label: "日期",
        description: "返回日期中的日",
        params: [{ define: { type: "string" } }],
        return: { type: "number" },
      },
    },
  },
  {
    id: "logic",
    label: "逻辑函数",
    functions: {
      IF: {
        label: "条件判断",
        description: "根据条件返回不同值",
        params: [
          { define: { type: "boolean" } },
          { forwardInput: true },
          { forwardInput: true },
        ],
        return: { scope: "forwardParams", paramsIndex: 1 },
      },
      AND: {
        label: "并且",
        description: "所有条件均为真时返回真",
        params: [{ define: { type: "boolean" } }],
        loopAfterParams: 1,
        return: { type: "boolean" },
      },
      OR: {
        label: "或者",
        description: "任一条件为真时返回真",
        params: [{ define: { type: "boolean" } }],
        loopAfterParams: 1,
        return: { type: "boolean" },
      },
      NOT: {
        label: "取反",
        description: "反转条件结果",
        params: [{ define: { type: "boolean" } }],
        return: { type: "boolean" },
      },
      ISBLANK: {
        label: "是否为空",
        description: "判断值是否为空",
        params: [{ forwardInput: true }],
        return: { type: "boolean" },
      },
      ISEMPTY: {
        label: "是否无值",
        description: "判断值是否为 null、undefined 或空文本",
        params: [{ forwardInput: true }],
        return: { type: "boolean" },
      },
    },
  },
  {
    id: "advanced",
    label: "其他函数",
    functions: {
      MAPX: {
        label: "跨表取数",
        description: "跨表或集合取数",
        params: [{ forwardInput: true }],
        return: { scope: "forwardParams", paramsIndex: 0 },
      },
      COALESCE: {
        label: "首个非空值",
        description: "返回参数中第一个非空值",
        params: [{ forwardInput: true }],
        loopAfterParams: 1,
        return: { scope: "forwardParams", paramsIndex: 0 },
      },
    },
  },
];

export const FORMULA_FUNCTION_ITEMS = FORMULA_FUNCTION_GROUPS.flatMap((group) =>
  Object.entries(group.functions).map(([name, formulaFunction]) => ({
    group: group.label,
    name,
    label: formulaFunction.label ?? name,
    description:
      typeof formulaFunction.description === "string"
        ? formulaFunction.description
        : "",
  })),
);
