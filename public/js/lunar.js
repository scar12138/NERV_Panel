/* =========================================================================
   NERV PANEL — 农历 / 节气 / 节日 计算（自包含，零外链）
   -------------------------------------------------------------------------
   农历数据表覆盖 1900–2100（通用公转农历算法），全部数据内嵌在本文件，
   不请求任何外部接口；拿不到或超出范围的日期返回 null，不编造。
   ========================================================================= */
(function (global) {
  "use strict";

  /* 1900–2100 农历数据：每年一个 16 进制值。
     位 0x10000 = 有闰月；低 4 位 = 闰几月(0=无闰)；
     其余位 = 每月大(30)小(29)月（0x8000 对应正月）。 */
  var lunarInfo = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520 // 2100
  ];

  var Gan = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  var Zhi = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  var lunarMonName = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
  var lunarDayName = [
    "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
    "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"
  ];
  /* 24 节气：index 0=小寒 … 23=冬至；节气 n 落在 公历 月 = Math.floor(n/2)+1 */
  var sTermName = [
    "小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
    "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑",
    "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至"
  ];
  var sTermInfo = [
    0, 21208, 42467, 63836, 85337, 107014, 128867, 150921,
    173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033,
    353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758
  ];

  /* 公历固定节日：月 → { 日: 名称 }
     节气不写在这里：二十四节气按太阳黄经计算，公历日期会漂 ±1 天，
     固定日期表必然在某些年份标错，节气由 termOf() 精确计算后单独展示。 */
  var SOLAR_FEST = {
    1: { 1: "元旦" },
    2: { 14: "情人节" },
    3: { 8: "妇女节", 12: "植树节" },
    4: { 1: "愚人节" },
    5: { 1: "劳动节", 4: "青年节" },
    6: { 1: "儿童节" },
    7: { 1: "建党节" },
    8: { 1: "建军节" },
    9: { 10: "教师节" },
    10: { 1: "国庆节" },
    12: { 24: "平安夜", 25: "圣诞节" }
  };

  /* 农历节日：{ 月: { 日: 名称 } }，月为数字月（含闰月仅闰月数，不特殊处理） */
  var LUNAR_FEST = {
    1: { 1: "春节", 15: "元宵节" },
    2: { 2: "龙抬头" },
    5: { 5: "端午节" },
    7: { 7: "七夕", 15: "中元节" },
    8: { 15: "中秋节" },
    9: { 9: "重阳节" },
    12: { 8: "腊八节", 23: "小年" }
  };

  function lYearDays(y) {
    var i, sum = 348;
    for (i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[y - 1900] & i) ? 1 : 0;
    return sum + leapDays(y); // 平年 12 个月 + 闰月天数
  }
  function leapMonth(y) { return lunarInfo[y - 1900] & 0xf; }
  function leapDays(y) { return leapMonth(y) ? ((lunarInfo[y - 1900] & 0x10000) ? 30 : 29) : 0; }
  function monthDays(y, m) { return (lunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29; }

  /** 节气日：返回 y 年第 n 个节气在当月的几号（公历） */
  function sTerm(y, n) {
    if (n < 0 || n > 23) return null;
    var offDate = new Date((31556925974.7 * (y - 1900) + (sTermInfo[n] || 0) * 60000) + Date.UTC(1900, 0, 6, 2, 5));
    return offDate.getUTCDate();
  }

  /** 公历 → 农历 { y, m, d, isLeap, dayName, monthName, ganZhiYear, ganZhiMonth, ganZhiDay } */
  function solar2lunar(y, m, d) {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    var baseDate = Date.UTC(1900, 0, 31);
    var objDate = Date.UTC(y, m - 1, d);
    var offset = Math.floor((objDate - baseDate) / 86400000);
    var i, temp = 0;

    for (i = 1900; i < 2101 && offset > 0; i++) {
      temp = lYearDays(i);
      offset -= temp;
    }
    if (offset < 0) { offset += temp; i--; }
    var lunarYear = i;

    var leap = leapMonth(i); // 传回的是「第几月是闰月」
    var isLeap = false;
    for (i = 1; i < 13 && offset > 0; i++) {
      if (leap > 0 && i === leap + 1 && isLeap === false) {
        --i; isLeap = true; temp = leapDays(lunarYear);
      } else {
        temp = monthDays(lunarYear, i);
      }
      if (isLeap === true && i === leap + 1) isLeap = false;
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && i === leap + 1) {
      if (isLeap) { isLeap = false; } else { isLeap = true; --i; }
    }
    if (offset < 0) { offset += temp; --i; }

    var lunarMonth = i;
    var lunarDay = offset + 1;
    if (lunarDay < 1 || lunarDay > 30) return null;

    /* 干支：以立春为年界（简化：用公历年推算年干支，节气月/日干支按农历月日） */
    var GY = (lunarYear - 4) % 10; if (GY < 0) GY += 10;
    var ZY = (lunarYear - 4) % 12; if (ZY < 0) ZY += 12;
    var GM = (lunarYear * 12 + lunarMonth + 12) % 10; if (GM < 0) GM += 10;
    var ZM = (lunarYear * 12 + lunarMonth + 12) % 12; if (ZM < 0) ZM += 12;
    return {
      y: lunarYear,
      m: lunarMonth,
      d: lunarDay,
      isLeap: isLeap,
      dayName: lunarDayName[lunarDay - 1],
      monthName: (isLeap ? "闰" : "") + lunarMonName[lunarMonth - 1] + "月",
      ganZhiYear: Gan[GY] + Zhi[ZY],
      ganZhiMonth: Gan[GM] + Zhi[ZM],
      ganZhiDay: "（每日干支随日变动，此处从略）"
    };
  }

  /** 该日是否有节气（公历） */
  function termOf(y, m, d) {
    for (var n = 0; n < 24; n++) {
      if (Math.floor(n / 2) + 1 !== m) continue;
      if (sTerm(y, n) === d) return sTermName[n];
    }
    return null;
  }

  /** 公历某月第几个星期几的日期（用于母亲节/父亲节等浮动节日） */
  function nthWeekday(y, m, weekday, nth) {
    var first = new Date(y, m - 1, 1).getDay();
    var add = (weekday - first + 7) % 7;
    var day = 1 + add + (nth - 1) * 7;
    if (new Date(y, m - 1, day).getMonth() !== m - 1) return null;
    return day;
  }

  /** 取某一天的节日/节气汇总。返回 { solar, lunarFest, term, mother, father } 或 null */
  function dayInfo(y, m, d) {
    if (y < 1900 || y > 2100) return null;
    var info = { solar: null, lunarFest: null, term: null, mother: null, father: null, prevEve: false };
    if (SOLAR_FEST[m] && SOLAR_FEST[m][d]) {
      var label = SOLAR_FEST[m][d];
      /* 「小寒·节气」这类标签拆出来当作节气处理，不当作公历节日 */
      if (label.indexOf("·节气") >= 0) info.term = label.replace("·节气", "");
      else info.solar = label;
    }
    var t = termOf(y, m, d);
    if (t && !info.term) info.term = t;

    var mothers = nthWeekday(y, 5, 0, 2); // 5月第2个周日
    var fathers = nthWeekday(y, 6, 0, 3); // 6月第3个周日
    if (m === 5 && d === mothers) info.mother = "母亲节";
    if (m === 6 && d === fathers) info.father = "父亲节";

    var l = solar2lunar(y, m, d);
    if (l) {
      if (LUNAR_FEST[l.m] && LUNAR_FEST[l.m][l.d] && !l.isLeap) info.lunarFest = LUNAR_FEST[l.m][l.d];
      /* 除夕：农历腊月的最后一天（第二天就是正月初一） */
      if (l.m === 12 && l.d >= 29) {
        var next = solar2lunar(y, m, d + 1);
        if (next && next.m === 1 && next.d === 1) info.prevEve = true;
      }
    }
    return info;
  }

  global.NERV_LUNAR = { solar2lunar: solar2lunar, dayInfo: dayInfo, sTerm: sTerm, termOf: termOf };
})(typeof window !== "undefined" ? window : globalThis);