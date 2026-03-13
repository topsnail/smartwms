import dayjs from "dayjs";

/**
 * 全局统一的日期快捷范围，用于所有需要“今天 / 近7天 / 近30天 / 本月 / 上月”的筛选场景。
 * 使用函数返回，保证每次渲染时都基于当前时间计算。
 */
export function buildCommonRangePresets() {
  const endToday = dayjs().endOf("day");
  return [
    { label: "今天", value: [dayjs().startOf("day"), endToday] as [dayjs.Dayjs, dayjs.Dayjs] },
    { label: "近7天", value: [dayjs().subtract(6, "day").startOf("day"), endToday] as [dayjs.Dayjs, dayjs.Dayjs] },
    { label: "近30天", value: [dayjs().subtract(29, "day").startOf("day"), endToday] as [dayjs.Dayjs, dayjs.Dayjs] },
    { label: "本月", value: [dayjs().startOf("month"), endToday] as [dayjs.Dayjs, dayjs.Dayjs] },
    {
      label: "上月",
      value: [
        dayjs().subtract(1, "month").startOf("month"),
        dayjs().subtract(1, "month").endOf("month"),
      ] as [dayjs.Dayjs, dayjs.Dayjs],
    },
  ];
}

