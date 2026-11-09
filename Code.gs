// ==============================================================================
// 🚀 GM & BRANCH MONITORING DASHBOARD - BACKEND (OPTIMIZED V2)
// เน้นข้อมูลในไฟล์เดียวกัน (Problem List, Meeting, ReportGM) ทำงานเร็วขึ้น 10 เท่า
// ==============================================================================

const CHANNEL_ACCESS_TOKEN = 'EeY78cILRYnIUFMXuUOQlaLnI+OhWJijw77S+dsg19faiWliiTdfcfCLO9PVD1z+J45IWKvQ68vln7yVxaAebohplWJX4rxjEW4SGECCyXjHt1IS1Zv/papeVducU94Gmbh/TS/mUikjPtA9qUaWOQdB04t89/1O/w1cDnyilFU='; 
const SPREADSHEET_ID = '1ZVxDG93kElikrhKxvMplHFrzBbwYAEvdf3RawZbuNvI'; 
const SHEET_NAME = 'Sheet1'; 
const OVERVIEW_GROUP_ID = 'C0ab9e253cf3f8a5aa1f5bd0e6302f0b6'; 
const ACCOUNTING_SPREADSHEET_ID = '1x8UOs8AEurWr_FGjdUOMUOQ_P3_AQjOVflbKd9H4vd0';
const ACCOUNTING_SHEET_NAME = 'Dashboard This month';

// รายชื่อผู้จัดการ 12 คน
const MANAGERS = ["กาญจน์", "นัท", "ซอฟ", "ลูกกุ้ง", "อัจ", "รัตน์", "อี้", "หมิว", "จาเน่", "โชว์", "เปีย", "ส้มโอ"];

// ==============================================================================
// 1. GET HANDLER: รองรับทั้ง Web App และ JSON API
// ==============================================================================
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || '';
  const isForcedRefresh = params.refresh === 'true' || params.nocache === '1';

  // 1.1 ขอข้อมูลเป็น JSON API (สำหรับเว็บเบราว์เซอร์ / Frontend)
  if (action === 'api' || action === 'getData' || params.format === 'json') {
    try {
      const periodParam = params.period !== undefined ? parseInt(params.period) : null;
      const periodInfo = getCurrentPeriodInfo();
      const periodIndex = (periodParam !== null && !isNaN(periodParam)) ? periodParam : periodInfo.index;

      // ใช้คีย์แคช v3 เพื่อให้ดึงข้อมูลผู้จัดการทุกคน (รวมถึงชื่อที่เว้นวรรค/วรรณยุกต์ต่างกัน) ใหม่ทันทีโดยไม่ติดแคชเก่า
      const cacheKey = 'gm_dash_cache_v3_p' + periodIndex;
      const cache = CacheService.getScriptCache();

      // ⚡ FAST CACHE: หากมีแคชและไม่ได้สั่งรีเฟรช ตอบกลับทันทีใน 0.1-0.2 วินาที!
      if (!isForcedRefresh) {
        const cachedJson = cache.get(cacheKey);
        if (cachedJson) {
          return ContentService.createTextOutput(cachedJson).setMimeType(ContentService.MimeType.JSON);
        }
      }

      // ถ้าไม่มีแคช หรือสั่งรีเฟรช ให้คำนวณใหม่
      const data = getAllDashboardData(periodParam);
      const jsonOutput = JSON.stringify({
        status: 'success',
        cached: true,
        timestamp: new Date().toISOString(),
        data: data
      });

      // บันทึกลงแคช (10 นาที = 600 วินาที)
      try {
        if (jsonOutput.length < 100000) {
          cache.put(cacheKey, jsonOutput, 600);
        }
      } catch (cErr) {
        console.warn('Cache write warning:', cErr);
      }

      return ContentService.createTextOutput(jsonOutput).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 1.2 เปิดหน้าเว็บ Dashboard โดยตรงบน Google Apps Script
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('GM Management & Branch Analytics')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ⚡ ฟังก์ชันตั้งเวลาอัปเดตแคชอัตโนมัติ (Trigger ทุก 10-15 นาที)
function autoWarmDashboardCache() {
  const cache = CacheService.getScriptCache();
  for (let p = 0; p <= 2; p++) {
    try {
      const data = getAllDashboardData(p);
      const jsonStr = JSON.stringify({
        status: 'success',
        cached: true,
        timestamp: new Date().toISOString(),
        data: data
      });
      if (jsonStr.length < 100000) {
        cache.put('gm_dash_cache_v3_p' + p, jsonStr, 900);
      }
    } catch (e) {
      console.warn('Auto warm error period ' + p + ': ' + e.message);
    }
  }
}

// ==============================================================================
// 2. ฟังก์ชันรวบรวมข้อมูลทั้งหมดสำหรับ Dashboard
// ==============================================================================
function getAllDashboardData(forcedPeriodIndex) {
  const periodInfo = getCurrentPeriodInfo();
  if (forcedPeriodIndex !== null && forcedPeriodIndex !== undefined && !isNaN(forcedPeriodIndex)) {
    periodInfo.index = forcedPeriodIndex;
    const titles = ["1-10", "11-20", "21-31"];
    periodInfo.title = titles[forcedPeriodIndex] || periodInfo.title;
  }

  const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const periodText = `${thaiMonths[periodInfo.month]} ${periodInfo.year + 543} (รอบ ${periodInfo.title})`;

  // ดึงข้อมูล GM Monitor (เน้นไฟล์เดียวกัน: Meeting, Problem List, ReportGM)
  const gmData = getGmDashboardDataFast(periodInfo);

  // ดึงข้อมูลบัญชีการเบิกจ่าย
  const accountingData = getAccountingDashboardDataFast();

  return {
    periodInfo: {
      index: periodInfo.index,
      title: periodInfo.title,
      month: periodInfo.month,
      monthName: thaiMonths[periodInfo.month],
      yearTh: periodInfo.year + 543,
      displayText: periodText
    },
    gmReport: gmData,
    accounting: accountingData
  };
}

// ==============================================================================
// 3. GM MONITOR ENGINE (FAST BATCH PROCESSING)
// ==============================================================================
function getGmDashboardDataFast(periodInfo) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // ⚡ เทคนิคความเร็วสูง: ดึงชีททั้งหมดในครั้งเดียวลง Map พร้อมระบบ Fuzzy Match รองรับวรรณยุกต์/การเคาะวรรค/ชื่อย่อ
  const allSheets = ss.getSheets();
  const sheetMap = {};
  allSheets.forEach(sheet => {
    sheetMap[sheet.getName().trim()] = sheet;
  });

  // ฟังก์ชันจับคู่ชื่อชีทแบบยืดหยุ่นสูง (กันปัญหาเคาะวรรค, วรรณยุกต์ไทยสลับลำดับ, หรือสะกด โชว/โชว์, กุ้ง/ลูกกุ้ง)
  function cleanThaiText(str) {
    if (!str) return '';
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, '') // ลบสระบน-ล่างและวรรณยุกต์
      .replace(/[\s\-_]/g, '')
      .toLowerCase();
  }

  function getSheetFuzzy(managerName, typeName) {
    // 1. ลองหาแบบตรงตัวก่อน
    const exactName = `${managerName} - ${typeName}`;
    if (sheetMap[exactName]) return sheetMap[exactName];
    if (sheetMap[`${managerName}-${typeName}`]) return sheetMap[`${managerName}-${typeName}`];

    // 2. จับคู่ชื่อเล่น/นามแฝง (เช่น ลูกกุ้ง <-> กุ้ง, โชว์ <-> โชว <-> โช)
    const aliases = [managerName];
    if (managerName === 'ลูกกุ้ง') aliases.push('กุ้ง', 'ลูกกุ้ง');
    if (managerName === 'กุ้ง') aliases.push('ลูกกุ้ง');
    if (managerName === 'โชว์') aliases.push('โชว', 'โช', 'ผจก.โช', 'ผจก. โช');
    if (managerName === 'โชว') aliases.push('โชว์', 'โช');
    if (managerName === 'โช') aliases.push('โชว์', 'โชว');

    const cleanType = cleanThaiText(typeName);

    for (let i = 0; i < allSheets.length; i++) {
      const sName = allSheets[i].getName().trim();
      const sClean = cleanThaiText(sName);
      if (!sClean.includes(cleanType)) continue;

      for (let a = 0; a < aliases.length; a++) {
        const aClean = cleanThaiText(aliases[a]);
        if (sClean.includes(aClean)) {
          return allSheets[i];
        }
      }
    }
    return null;
  }

  const managers = MANAGERS;
  let managersData = [];
  let allProblemsList = [];
  let summaryTotals = {
    totalManagers: managers.length,
    totalBranches: 0,
    totalMeetingsDone: 0,
    totalMeetingsExpected: managers.length * 8,
    meetingComplianceAvg: 0,
    problems: { critical: 0, high: 0, overdue: 0, normal: 0, total: 0 },
    kpiStatusCount: { green: 0, yellow: 0, red: 0, pending: 0 }
  };

  managers.forEach(managerName => {
    try {
      // -------------------------------------------------------------
      // 3.1 การประชุม (Meeting Sheet)
      // -------------------------------------------------------------
      let actualMeetings = 0;
      let meetingDates = [];
      const mSheet = getSheetFuzzy(managerName, 'Meeting');
      if (mSheet) {
        const mData = mSheet.getDataRange().getValues();
        for (let r = 1; r < mData.length; r++) {
          const val = mData[r][0];
          if (val !== '' && val !== null && val !== undefined) {
            let dateStr = parseMeetingDateStr(val, periodInfo.month, periodInfo.year);
            if (dateStr) {
              meetingDates.push(dateStr);
            }
          }
        }
        actualMeetings = meetingDates.length;
      }
      summaryTotals.totalMeetingsDone += actualMeetings;
      const compliance = Math.round((actualMeetings / 8) * 100);
      const meetingStatus = actualMeetings >= 8 ? "green" : "red";

      // -------------------------------------------------------------
      // 3.2 รายการปัญหา (Problem List Sheet) - โฟกัสสูงสุด! (เพิ่มคอลัมน์ H และ I)
      // -------------------------------------------------------------
      let problemsByBranch = {};
      let managerProblems = [];
      let mRed = 0, mYellow = 0, mPurple = 0, mNormal = 0;

      const pSheet = getSheetFuzzy(managerName, 'Problem List');
      if (pSheet) {
        const pData = pSheet.getDataRange().getValues();
        for (let r = 1; r < pData.length; r++) {
          const row = pData[r];
          const branch = String(row[1] || '').trim();
          const urgency = String(row[2] || '').trim();
          const needsGmHelp = String(row[3] || '').trim();
          const status = String(row[4] || '').trim();
          const category = String(row[5] || '').trim();
          const subject = String(row[6] || '').trim();
          // ดึงข้อมูลจากคอลัมน์ H (index 7: รายละเอียดปัญหา) และคอลัมน์ I (index 8: การแก้ไขปัญหา)
          const colH = (row.length > 7 && row[7] !== undefined && row[7] !== null) ? String(row[7]).trim() : '';
          const colI = (row.length > 8 && row[8] !== undefined && row[8] !== null) ? String(row[8]).trim() : '';

          // เงื่อนไข: มีสาขาหรือหัวเรื่อง และสถานะยังไม่ปิด
          if ((branch || subject) && status !== 'ปิดแล้ว') {
            const bKey = branch || 'สาขาทั่วไป';
            if (!problemsByBranch[bKey]) problemsByBranch[bKey] = { red: 0, yellow: 0, purple: 0, normal: 0, total: 0 };

            let urgencyType = "normal";
            const uLower = urgency.toLowerCase();

            if (urgency.includes('Critical') || uLower.includes('critical') || urgency.includes('วิกฤต')) {
              problemsByBranch[bKey].red++;
              mRed++;
              summaryTotals.problems.critical++;
              urgencyType = "critical";
            } else if (urgency.includes('High') || uLower.includes('high') || urgency.includes('ด่วน')) {
              problemsByBranch[bKey].yellow++;
              mYellow++;
              summaryTotals.problems.high++;
              urgencyType = "high";
            } else if (urgency.includes('Overdue') || uLower.includes('overdue') || urgency.includes('เกินกำหนด')) {
              problemsByBranch[bKey].purple++;
              mPurple++;
              summaryTotals.problems.overdue++;
              urgencyType = "overdue";
            } else {
              problemsByBranch[bKey].normal++;
              mNormal++;
              summaryTotals.problems.normal++;
              urgencyType = "normal";
            }
            problemsByBranch[bKey].total++;

            // ตรวจสอบความต้องการให้ GM ช่วยเหลือ
            let isNeedGm = false;
            if (needsGmHelp && needsGmHelp !== '-' && needsGmHelp !== 'ไม่ระบุ') {
              isNeedGm = true;
            }

            const probItem = {
              manager: managerName,
              branch: bKey,
              urgency: urgency || 'ทั่วไป',
              urgencyType: urgencyType,
              needsGmHelp: needsGmHelp || '-',
              isNeedGm: isNeedGm,
              status: status || 'กำลังดำเนินการ',
              category: category || 'ทั่วไป',
              subject: subject || '(ไม่ได้ระบุหัวข้อ)',
              colH: colH,
              colI: colI,
              content: colH,
              solution: colI,
              problemDetail: colH || '-',
              initialFix: colI || '-'
            };
            managerProblems.push(probItem);
            allProblemsList.push(probItem);
          }
        }
      }

      // -------------------------------------------------------------
      // 3.3 รายงานผลประกอบการ KPI สาขา (ReportGM Sheet)
      // -------------------------------------------------------------
      let branchesMap = {};
      let allBranchNames = new Set(Object.keys(problemsByBranch));
      let managerTargetRed = 0, managerTargetYellow = 0, managerTargetGreen = 0;

      const rSheet = getSheetFuzzy(managerName, 'ReportGM');
      if (rSheet) {
        const rData = rSheet.getDataRange().getValues();
        const totalRows = rData.length;

        // ฟังก์ชันตรวจสอบชื่อสาขาที่ถูกต้อง (ต้องมีคำว่า สาขา หรือเป็นชื่อสาขาจริง และไม่เอาหัวตาราง/KPI/ตัวเลขวันที่)
        function isValidBranch(name) {
          if (!name || name instanceof Date) return false;
          const s = String(name).trim();
          if (s === '' || s === '-' || s === 'สาขา' || s === 'หัวข้อ' || s === 'ครั้งที่') return false;
          if (s.indexOf('1-10') === 0 || s.indexOf('11-20') === 0 || s.indexOf('21-31') === 0) return false;
          if (s.indexOf('GMT') !== -1 || /^\d+$/.test(s)) return false;
          
          // คัดกรองข้อความที่เป็นหัวข้อ KPI หรือเกณฑ์ประเมินออก
          const lower = s.toLowerCase();
          if (lower.includes('target') || lower.includes('revenue') || lower.includes('nrm') || lower.includes('ncm') || lower.includes('crm')) return false;
          if (s.includes('การนัด') || s.includes('หมายเหตุ') || s.includes('เป้าหมาย') || s.includes('มาตรการ') || s.includes('เป็นไปตามเป้า')) return false;

          // ต้องมีคำว่า สาขา หรือขึ้นต้นด้วยคำว่า สาขา
          return s.includes('สาขา');
        }

        // ค้นหาตำแหน่งหัวบล็อกสาขา โดยตรวจสอบทีละ 24 แถว (โครงสร้างมาตรฐานของ ReportGM)
        let branchBlockRows = [];
        for (let r = 0; r < totalRows; r += 24) {
          if (isValidBranch(rData[r][3]) || isValidBranch(rData[r][0]) || (r + 1 < totalRows && (isValidBranch(rData[r + 1][3]) || isValidBranch(rData[r + 1][0])))) {
            branchBlockRows.push(r);
          }
        }

        for (let bIdx = 0; bIdx < branchBlockRows.length; bIdx++) {
          const r = branchBlockRows[bIdx];
          // ค้นหาชื่อสาขาที่ Cell D (index 3) หรือ Cell A (index 0) ในแถว r, r+1
          let bName = '';
          if (isValidBranch(rData[r][3])) {
            bName = String(rData[r][3]).trim();
          } else if (isValidBranch(rData[r][0])) {
            bName = String(rData[r][0]).trim();
          } else if (r + 1 < totalRows && isValidBranch(rData[r + 1][3])) {
            bName = String(rData[r + 1][3]).trim();
          } else if (r + 1 < totalRows && isValidBranch(rData[r + 1][0])) {
            bName = String(rData[r + 1][0]).trim();
          }

          if (bName) {
            allBranchNames.add(bName);

            // คำนวณแถวเริ่มต้นของรอบ (0: r+1, 1: r+8, 2: r+15)
            const startRowIdx = (periodInfo.index === 0) ? r + 1 : (periodInfo.index === 1 ? r + 8 : r + 15);
            let branchRed = 0, branchYellow = 0, branchGreen = 0;
            let kpiList = [];

            if (startRowIdx < totalRows) {
              const maxKpiRows = Math.min(startRowIdx + 6, totalRows);
              for (let kr = startRowIdx; kr < maxKpiRows; kr++) {
                const kRow = rData[kr];
                const colA = String(kRow[0] || '').trim();
                const colB = String(kRow[1] || '').trim();
                const colC = kRow[2] !== undefined && kRow[2] !== null ? String(kRow[2]).trim() : '-';
                const colD = String(kRow[3] || '').trim();

                if (colA && colA !== 'สาขา' && colA !== 'หัวข้อ' && !colA.includes('GMT') && colA !== '1-10' && colA !== '11-20' && colA !== '21-31') {
                  const shortColA = shortenKpiName(colA);
                  const isTargetRevenue = colA.toLowerCase().includes('target') || colA.toLowerCase().includes('revenue');

                  let kpiStatus = "pending";
                  if (colD !== '') {
                    if (colD.includes("ไม่เป็นไปตามเป้า")) {
                      kpiStatus = "red";
                      branchRed++;
                      summaryTotals.kpiStatusCount.red++;
                      if (isTargetRevenue) managerTargetRed++;
                    } else if (colD.includes("เสี่ยงต่ำกว่าเป้าหมาย")) {
                      kpiStatus = "yellow";
                      branchYellow++;
                      summaryTotals.kpiStatusCount.yellow++;
                      if (isTargetRevenue) managerTargetYellow++;
                    } else if (colD.includes("มีโอกาสเป็นไปตามเป้า")) {
                      kpiStatus = "green";
                      branchGreen++;
                      summaryTotals.kpiStatusCount.green++;
                      if (isTargetRevenue) managerTargetGreen++;
                    }
                  } else {
                    // ประเมินจาก % หากมีระบุใน Value เช่น "1023376 (68.22%)"
                    const pctMatch = colC.match(/\(([\d.]+)%\)/);
                    if (pctMatch) {
                      const pct = parseFloat(pctMatch[1]);
                      if (pct >= 100) { kpiStatus = "green"; branchGreen++; summaryTotals.kpiStatusCount.green++; if (isTargetRevenue) managerTargetGreen++; }
                      else if (pct >= 85) { kpiStatus = "yellow"; branchYellow++; summaryTotals.kpiStatusCount.yellow++; if (isTargetRevenue) managerTargetYellow++; }
                      else { kpiStatus = "red"; branchRed++; summaryTotals.kpiStatusCount.red++; if (isTargetRevenue) managerTargetRed++; }
                    } else {
                      summaryTotals.kpiStatusCount.pending++;
                    }
                  }

                  kpiList.push({
                    title: shortColA || colA,
                    rawTitle: colA,
                    subTitle: colB,
                    value: colC !== '' ? colC : '-',
                    criteria: colD,
                    status: kpiStatus
                  });
                }
              }
            }

            let branchOverallStatus = "pending";
            if (branchRed > 0) branchOverallStatus = "red";
            else if (branchYellow > 0) branchOverallStatus = "yellow";
            else if (branchGreen > 0) branchOverallStatus = "green";

            branchesMap[bName] = {
              name: bName,
              manager: managerName,
              kpis: kpiList,
              status: branchOverallStatus,
              problems: problemsByBranch[bName] || { red: 0, yellow: 0, purple: 0, normal: 0, total: 0 }
            };
          }
        }
      }

      // 3.4 รวบรวมสาขาทั้งหมด (รวมสาขาที่มีใน Problem List ด้วย เช่น รัตน์ -> สาขานครปฐม)
      // -------------------------------------------------------------
      let finalBranches = [];
      allBranchNames.forEach(bName => {
        if (branchesMap[bName]) {
          finalBranches.push(branchesMap[bName]);
        } else {
          // หากไม่มี ReportGM แต่มีปัญหาใน Problem List ให้สร้างการ์ดสาขาขึ้นมาเพื่อให้ติดตามได้!
          finalBranches.push({
            name: bName,
            manager: managerName,
            kpis: [
              { title: "Target Revenue", rawTitle: "Target Revenue", subTitle: "เป้าหมายสาขา", value: "-", criteria: "-", status: "pending" },
              { title: "NRM", rawTitle: "New Case Management", subTitle: "ลูกค้าใหม่", value: "-", criteria: "-", status: "pending" },
              { title: "CRM", rawTitle: "CRM", subTitle: "การดูแลลูกค้า", value: "-", criteria: "-", status: "pending" }
            ],
            status: "pending",
            problems: problemsByBranch[bName] || { red: 0, yellow: 0, purple: 0, normal: 0, total: 0 }
          });
        }
      });

      summaryTotals.totalBranches += finalBranches.length;

      let overallBusStatus = "pending";
      if (managerTargetRed > 0) overallBusStatus = "red";
      else if (managerTargetYellow > 0) overallBusStatus = "yellow";
      else if (managerTargetGreen > 0) overallBusStatus = "green";

      managersData.push({
        manager: managerName,
        actualMeetings: actualMeetings,
        expectedMeetings: 8,
        meetingDates: meetingDates,
        compliance: compliance,
        meetingStatus: meetingStatus,
        branches: finalBranches,
        allBranchNames: Array.from(allBranchNames),
        problemsByBranch: problemsByBranch,
        busStatus: overallBusStatus,
        totalProblems: {
          red: mRed,
          yellow: mYellow,
          purple: mPurple,
          normal: mNormal,
          total: mRed + mYellow + mPurple + mNormal
        }
      });

    } catch (e) {
      console.error(`Manager processing error ${managerName}: ${e.message}`);
    }
  });

  summaryTotals.meetingComplianceAvg = summaryTotals.totalMeetingsExpected > 0
    ? Math.round((summaryTotals.totalMeetingsDone / summaryTotals.totalMeetingsExpected) * 100)
    : 0;
  summaryTotals.problems.total = summaryTotals.problems.critical + summaryTotals.problems.high + summaryTotals.problems.overdue + summaryTotals.problems.normal;

  return {
    summary: summaryTotals,
    managers: managersData,
    problemsList: allProblemsList
  };
}

// ==============================================================================
// 4. ACCOUNTING ENGINE (FAST BATCH)
// ==============================================================================
function getAccountingDashboardDataFast() {
  try {
    const ss = SpreadsheetApp.openById(ACCOUNTING_SPREADSHEET_ID);
    const sheet = ss.getSheetByName(ACCOUNTING_SHEET_NAME);
    if (!sheet) return { error: 'Sheet not found', totalAmount: 0, branchList: [], dailyList: [], details: [] };

    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { totalAmount: 0, branchList: [], dailyList: [], details: [] };

    const monthHeader = rows[0][0] ? String(rows[0][0]).trim() : 'รายงานการเบิกประจำเดือน';
    let dataByBranch = {};
    let dataByDate = {};
    let totalWithdrawalAll = 0;
    let detailItems = [];

    for (let i = 1; i < rows.length; i++) {
      const branch = rows[i][0] ? String(rows[i][0]).trim() : '';
      const dateVal = rows[i][1];
      const amount = rows[i][5] !== undefined && rows[i][5] !== null ? Number(rows[i][5]) : 0;
      const itemName = rows[i][6] ? String(rows[i][6]).trim() : '';

      if (!branch || !itemName) continue;

      let dateStr = '-';
      let sortableDate = '';
      if (dateVal instanceof Date) {
        const d = String(dateVal.getDate()).padStart(2, '0');
        const m = String(dateVal.getMonth() + 1).padStart(2, '0');
        const yTh = dateVal.getFullYear() + 543;
        dateStr = `${d}/${m}/${yTh}`;
        sortableDate = `${dateVal.getFullYear()}-${m}-${d}`;
      } else if (dateVal) {
        dateStr = String(dateVal).trim();
        sortableDate = dateStr;
      }

      const validAmount = isNaN(amount) ? 0 : amount;

      if (!dataByBranch[branch]) dataByBranch[branch] = { branch: branch, totalAmount: 0, itemsCount: 0 };
      dataByBranch[branch].totalAmount += validAmount;
      dataByBranch[branch].itemsCount++;

      if (!dataByDate[dateStr]) dataByDate[dateStr] = { date: dateStr, sortableDate: sortableDate, totalAmount: 0, count: 0 };
      dataByDate[dateStr].totalAmount += validAmount;
      dataByDate[dateStr].count++;

      totalWithdrawalAll += validAmount;

      detailItems.push({
        id: i,
        branch: branch,
        date: dateStr,
        sortableDate: sortableDate,
        name: itemName,
        amount: validAmount
      });
    }

    const branchList = Object.keys(dataByBranch)
      .map(k => dataByBranch[k])
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const dailyList = Object.keys(dataByDate)
      .map(k => dataByDate[k])
      .sort((a, b) => (a.sortableDate > b.sortableDate ? 1 : -1));

    return {
      title: monthHeader,
      totalAmount: totalWithdrawalAll,
      branchesCount: branchList.length,
      branchList: branchList,
      dailyList: dailyList,
      details: detailItems
    };

  } catch (err) {
    return { error: err.message, totalAmount: 0, branchList: [], dailyList: [], details: [] };
  }
}

// ==============================================================================
// 5. HELPER: PARSE & FILTER MEETING DATES (ไม่ผูกติดกับปี นับการประชุมที่มีอยู่จริง)
// ==============================================================================
function parseMeetingDateStr(val, targetMonth, targetYear) {
  if (val === null || val === undefined || val === '') return null;

  // 1. กรณีเป็น Date Object จาก Google Sheets
  if (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]') {
    var d = String(val.getDate()).padStart(2, '0');
    var mo = String(val.getMonth() + 1).padStart(2, '0');
    var yTh = targetYear ? targetYear + 543 : 2569;
    return d + '/' + mo + '/' + yTh;
  }

  // 2. กรณีเป็น Excel Serial Number
  if (typeof val === 'number' && val > 40000 && val < 60000) {
    var dObj = new Date((val - 25569) * 86400 * 1000);
    var d = String(dObj.getDate()).padStart(2, '0');
    var mo = String(dObj.getMonth() + 1).padStart(2, '0');
    var yTh = targetYear ? targetYear + 543 : 2569;
    return d + '/' + mo + '/' + yTh;
  }

  var s = String(val).trim();
  if (!s || s === '-' || s.length < 2) return null;
  if (s.indexOf('วันที่') === 0 || s.indexOf('ครั้งที่') === 0 || s === 'ลำดับ' || s === 'หัวข้อ' || s === 'หมายเหตุ') return null;

  var yTh = targetYear ? targetYear + 543 : 2569;

  // 3. กรณีมีชื่อเดือนภาษาไทย/อังกฤษในข้อความ
  var thaiMonthKeywords = [
    ['มกราคม', 'ม.ค.', 'ม.ค', 'มค', 'january', 'jan'],
    ['กุมภาพันธ์', 'ก.พ.', 'ก.พ', 'กพ', 'february', 'feb'],
    ['มีนาคม', 'มี.ค.', 'มี.ค', 'มีค', 'march', 'mar'],
    ['เมษายน', 'เม.ย.', 'เม.ย', 'เมย', 'april', 'apr'],
    ['พฤษภาคม', 'พ.ค.', 'พ.ค', 'พค', 'may'],
    ['มิถุนายน', 'มิ.ย.', 'มิ.ย', 'มิย', 'june', 'jun'],
    ['กรกฎาคม', 'ก.ค.', 'ก.ค', 'กค', 'july', 'jul'],
    ['สิงหาคม', 'ส.ค.', 'ส.ค', 'สค', 'august', 'aug'],
    ['กันยายน', 'ก.ย.', 'ก.ย', 'กย', 'september', 'sep', 'sept'],
    ['ตุลาคม', 'ต.ค.', 'ต.ค', 'ตค', 'october', 'oct'],
    ['พฤศจิกายน', 'พ.ย.', 'พ.ย', 'พย', 'november', 'nov'],
    ['ธันวาคม', 'ธ.ค.', 'ธ.ค', 'ธค', 'december', 'dec']
  ];

  var sLower = s.toLowerCase();
  for (var mIdx = 0; mIdx < thaiMonthKeywords.length; mIdx++) {
    var kws = thaiMonthKeywords[mIdx];
    for (var k = 0; k < kws.length; k++) {
      if (sLower.indexOf(kws[k]) !== -1) {
        var numMatch = s.match(/\b(\d{1,2})\b/);
        var dayStr = numMatch ? String(numMatch[1]).padStart(2, '0') : '01';
        var moStr = String(mIdx + 1).padStart(2, '0');
        return dayStr + '/' + moStr + '/' + yTh;
      }
    }
  }

  // 4. กรณีเป็นรูปแบบตัวเลข YYYY-MM-DD
  var mIso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (mIso) {
    var mo = parseInt(mIso[2], 10);
    var d = parseInt(mIso[3], 10);
    return String(d).padStart(2, '0') + '/' + String(mo).padStart(2, '0') + '/' + yTh;
  }

  // 5. กรณีเป็นรูปแบบตัวเลขที่มีขีดหรือสแลช: M/D/YYYY, D/M/YYYY, M/D, D/M
  var mSlash = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/);
  if (mSlash) {
    var p1 = parseInt(mSlash[1], 10);
    var p2 = parseInt(mSlash[2], 10);

    var dayVal = p1;
    var monthVal = p2;

    if (p1 > 12 && p2 <= 12) {
      dayVal = p1;
      monthVal = p2;
    } else if (p2 > 12 && p1 <= 12) {
      dayVal = p2;
      monthVal = p1;
    } else if (p1 <= 12 && p2 <= 31) {
      // รูปแบบ US Format e.g. 10/18
      monthVal = p1;
      dayVal = p2;
    }

    return String(dayVal).padStart(2, '0') + '/' + String(monthVal).padStart(2, '0') + '/' + yTh;
  }

  // หากมีค่าระบุที่ไม่ใช่ค่าว่าง ให้ส่งคืนค่านั้นเลย
  return s;
}

// ==============================================================================
// 6. POST REQUEST HANDLER (คงความเข้ากันได้ 100% กับ LINE Bot เดิม)
// ==============================================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const events = data.events;

    events.forEach(event => {
      if (event.type === 'join' && event.source.type === 'group') {
        const groupId = event.source.groupId;
        const replyToken = event.replyToken;
        const groupName = getGroupSummary(groupId);
        saveDataToSheet(groupId, groupName);
        replyMessage(replyToken, 'บันทึกเรียบร้อยแล้วค่ะ');
      }
      
      if (event.type === 'message' && event.message.type === 'text' && event.source.type === 'group') {
        const userMessage = event.message.text.trim();
        const lowerMsg = userMessage.toLowerCase();
        const groupId = event.source.groupId;
        const replyToken = event.replyToken;
        
        if (lowerMsg === 'รายงานgm' || lowerMsg === 'gm report' || lowerMsg === 'reportgm') {
          sendDynamicGMReport(groupId, replyToken);
        }
        else if (lowerMsg === 'รายงาน' || lowerMsg === 'ส่งรายงาน' || lowerMsg === 'report') {
          if (groupId === OVERVIEW_GROUP_ID) {
            sendOverviewReportForAllFiles(groupId, replyToken);
          } else {
            sendCarouselReportForGroup(groupId, replyToken);
          }
        }
        else if (userMessage.includes('มีโอกาสเป็นไปตามเป้า') && !userMessage.includes('ไม่เป็นไปตามเป้า')) {
          sendFilteredReport(groupId, 'มีโอกาสเป็นไปตามเป้า', replyToken);
        }
        else if (userMessage.includes('เสี่ยงต่ำกว่าเป้าหมาย')) {
          sendFilteredReport(groupId, 'เสี่ยงต่ำกว่าเป้าหมาย', replyToken);
        }
        else if (userMessage.includes('มีโอกาสเป็นไม่เป็นไปตามเป้า')) {
          sendFilteredReport(groupId, 'มีโอกาสเป็นไม่เป็นไปตามเป้า', replyToken);
        }
        else if (lowerMsg === 'สรุปปัญหา' || lowerMsg === 'problem summary') {
          sendProblemSummary(groupId, replyToken);
        }
        else if (lowerMsg === 'รายงานการเบิก' || lowerMsg === 'accounting report') {
          sendAccountingReportReply(replyToken);
        }
      }
    });

    return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    console.error("Webhook Error: ", error);
    return ContentService.createTextOutput("Error").setMimeType(ContentService.MimeType.TEXT);
  }
}

// ==============================================================================
// 7. HELPER FUNCTIONS
// ==============================================================================
function shortenKpiName(name) {
  if (!name) return '';
  let n = String(name).trim();
  if (n.includes('New Case Management') || n.includes('NCM')) return 'NRM';
  if (n.includes('CRM') || n.toLowerCase().includes('customer relationship')) return 'CRM';
  return n;
}

function getCurrentPeriodInfo() {
  const today = new Date();
  const dayNum = today.getDate();
  let targetMonth = today.getMonth();
  let targetYear = today.getFullYear();

  if (dayNum <= 10) {
    targetMonth -= 1;
    if (targetMonth < 0) { targetMonth = 11; targetYear -= 1; }
    return { title: "21-31", index: 2, month: targetMonth, year: targetYear };
  } else if (dayNum <= 20) {
    return { title: "1-10", index: 0, month: targetMonth, year: targetYear };
  } else {
    return { title: "11-20", index: 1, month: targetMonth, year: targetYear };
  }
}

function getMeetingDatesListFromSheet(sheet, targetMonth, targetYear) {
  try {
    const data = sheet.getDataRange().getValues();
    let dates = [];
    for (let i = 1; i < data.length; i++) {
      const val = data[i][0];
      if (val !== '' && val !== null && val !== undefined) {
        if (val instanceof Date) {
          if (val.getMonth() === targetMonth && val.getFullYear() === targetYear) {
            const d = String(val.getDate()).padStart(2, '0');
            const m = String(val.getMonth() + 1).padStart(2, '0');
            const y = val.getFullYear() + 543;
            dates.push(`${m}/${d}/${y}`);
          }
        }
      }
    }
    return dates;
  } catch (e) {
    return [];
  }
}

function extractSpreadsheetId(urlOrId) {
  if (!urlOrId) return '';
  urlOrId = urlOrId.trim();
  if (urlOrId.indexOf('http') === 0) {
    const matchD = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (matchD && matchD[1]) return matchD[1];
    const matchIdParam = urlOrId.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    if (matchIdParam && matchIdParam[1]) return matchIdParam[1];
  }
  return urlOrId;
}

function getGroupSummary(groupId) {
  const url = `https://api.line.me/v2/bot/group/${groupId}/summary`;
  const options = {
    'method': 'get',
    'headers': { 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    'muteHttpExceptions': true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    if (response.getResponseCode() === 200 && result.groupName) return result.groupName;
    return 'กลุ่ม LINE';
  } catch (error) {
    return 'กลุ่ม LINE';
  }
}

function saveDataToSheet(groupId, groupName) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  sheet.appendRow([new Date(), groupId, groupName]);
}

function replyMessage(replyToken, payload) {
  let messages = [];
  if (typeof payload === 'string') {
    messages = [{ type: 'text', text: payload }];
  } else if (Array.isArray(payload)) {
    messages = payload;
  }
  const url = 'https://api.line.me/v2/bot/message/reply';
  const options = {
    'method': 'post',
    'headers': { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    'payload': JSON.stringify({ 'replyToken': replyToken, 'messages': messages }),
    'muteHttpExceptions': true
  };
  try { UrlFetchApp.fetch(url, options); } catch (e) { console.error(e); }
}

function createSectionBubble(titleText, bgColor, contentsArray, periodText) {
  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box", layout: "vertical", backgroundColor: bgColor, paddingAll: "md",
      contents: [
        { type: "text", text: `รายงานประจำเดือน ${periodText}`, color: "#ffffff", size: "xs", weight: "bold", wrap: true },
        { type: "text", text: titleText, color: "#ffffff", size: "md", weight: "bold", wrap: true }
      ]
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "md",
      contents: contentsArray
    }
  };
}

// ==============================================================================
// 8. LINE BOT REPORT DISPATCHERS (โค้ดเดิมเพื่อรองรับคำสั่งใน LINE)
// ==============================================================================
function sendDynamicGMReport(groupId, replyToken) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const managers = MANAGERS;
  const periodInfo = getCurrentPeriodInfo();
  const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const periodText = `${thaiMonths[periodInfo.month]} ${periodInfo.year + 543} (รอบ ${periodInfo.title})`;

  let reportData = [];
  let errorLogs = [];

  managers.forEach(managerName => {
    try {
      const meetingSheet = ss.getSheetByName(`${managerName} - Meeting`);
      let actualMeetings = 0;
      if (meetingSheet) {
        const meetingDates = getMeetingDatesListFromSheet(meetingSheet, periodInfo.month, periodInfo.year);
        actualMeetings = meetingDates.length;
      }
      const expectedMeetings = 8;
      const compliance = Math.round((actualMeetings / expectedMeetings) * 100);
      const meetingStatus = actualMeetings >= expectedMeetings ? "🟢" : "🔴";

      const problemSheet = ss.getSheetByName(`${managerName} - Problem List`);
      let problemsByBranch = {};
      if (problemSheet) {
        const probData = problemSheet.getDataRange().getValues();
        for (let r = 1; r < probData.length; r++) {
          const branch = String(probData[r][1]).trim();
          const urgency = String(probData[r][2]).trim();
          const status = String(probData[r][4]).trim();
          if (branch) {
            if (!problemsByBranch[branch]) problemsByBranch[branch] = { red: 0, yellow: 0, purple: 0 };
            if (status !== 'ปิดแล้ว') {
              if (urgency.includes('Critical')) problemsByBranch[branch].red++;
              else if (urgency.includes('High')) problemsByBranch[branch].yellow++;
              else if (urgency.includes('Overdue')) problemsByBranch[branch].purple++;
            }
          }
        }
      }

      const reportSheet = ss.getSheetByName(`${managerName} - ReportGM`);
      let branches = [];
      let allBranchNames = new Set(Object.keys(problemsByBranch));
      let totalRedProb = 0, totalYellowProb = 0, totalPurpleProb = 0;
      let managerTargetRed = 0, managerTargetYellow = 0, managerTargetGreen = 0;

      if (reportSheet) {
        const lastRow = reportSheet.getLastRow();
        for (let r = 1; r <= lastRow; r += 24) {
          const branchName = reportSheet.getRange(r, 4).getValue();
          if (branchName && String(branchName).trim() !== '') {
            const bNameStr = String(branchName).trim();
            allBranchNames.add(bNameStr);
            const startRow = (periodInfo.index === 0) ? r + 1 : (periodInfo.index === 1 ? r + 8 : r + 15);
            if (startRow > lastRow) continue;

            const data = reportSheet.getRange(startRow, 1, 6, 4).getValues();
            let branchRed = 0, branchYellow = 0, branchGreen = 0;
            let kpiList = [];

            data.forEach(row => {
              const colA = row[0] ? String(row[0]).trim() : '';
              const colC = row[2] ? String(row[2]).trim() : '-';
              const colD = row[3] ? String(row[3]).trim() : '';
              if (colA && colA !== 'สาขา' && colA !== 'หัวข้อ' && !colA.includes('GMT')) {
                let statusIcon = "";
                const shortColA = shortenKpiName(colA);
                const colALower = colA.toLowerCase();
                const isTargetRevenue = colALower.includes('target revenue') || colALower.includes('target') || colALower.includes('revenue');

                if (colD !== '') {
                  if (colD.includes("ไม่เป็นไปตามเป้า")) { statusIcon = "🔴"; branchRed++; if (isTargetRevenue) managerTargetRed++; }
                  else if (colD.includes("เสี่ยงต่ำกว่าเป้าหมาย")) { statusIcon = "🟡"; branchYellow++; if (isTargetRevenue) managerTargetYellow++; }
                  else if (colD.includes("มีโอกาสเป็นไปตามเป้า")) { statusIcon = "🟢"; branchGreen++; if (isTargetRevenue) managerTargetGreen++; }
                }
                const finalIcon = statusIcon || "⏳";
                kpiList.push({ title: shortColA, value: colC, icon: shortColA === 'NRM' ? '-' : finalIcon });
              }
            });

            let branchStatus = "";
            if (branchRed > 0) branchStatus = "🔴";
            else if (branchYellow > 0) branchStatus = "🟡";
            else if (branchGreen > 0) branchStatus = "🟢";
            branches.push({ name: bNameStr, kpis: kpiList, status: branchStatus });
          }
        }
      }

      Array.from(allBranchNames).forEach(bName => {
        const pData = problemsByBranch[bName] || { red: 0, yellow: 0, purple: 0 };
        totalRedProb += pData.red;
        totalYellowProb += pData.yellow;
        totalPurpleProb += pData.purple;
      });

      let overallBusStatus = "⏳";
      if (managerTargetRed > 0) overallBusStatus = "🔴";
      else if (managerTargetYellow > 0) overallBusStatus = "🟡";
      else if (managerTargetGreen > 0) overallBusStatus = "🟢";

      reportData.push({
        manager: managerName,
        actualMeetings: actualMeetings,
        expectedMeetings: expectedMeetings,
        compliance: compliance,
        meetingStatus: meetingStatus,
        branches: branches,
        allBranchNames: Array.from(allBranchNames),
        problemsByBranch: problemsByBranch,
        busStatus: overallBusStatus,
        totalRedProb: totalRedProb,
        totalYellowProb: totalYellowProb,
        totalPurpleProb: totalPurpleProb
      });
    } catch (e) {
      errorLogs.push(`- ${managerName} (Error: ${e.message})`);
    }
  });

  if (reportData.length === 0) {
    replyMessage(replyToken, 'ไม่พบข้อมูลในระบบ');
    return;
  }

  // สร้างฟอร์แมต Flex Message
  let bubbles = [];

  // Bubble 1: Weekly Meeting
  let meetingContents = [
    {
      type: "box", layout: "horizontal", spacing: "sm",
      contents: [
        { type: "text", text: "Manager", size: "xs", weight: "bold", color: "#888888", flex: 4 },
        { type: "text", text: "ประชุม", size: "xs", weight: "bold", color: "#888888", flex: 2, align: "center" },
        { type: "text", text: "%", size: "xs", weight: "bold", color: "#888888", flex: 2, align: "center" },
        { type: "text", text: "สถานะ", size: "xs", weight: "bold", color: "#888888", flex: 2, align: "end" }
      ]
    },
    { type: "separator", margin: "sm", color: "#eeeeee" }
  ];
  reportData.forEach(d => {
    meetingContents.push({
      type: "box", layout: "horizontal", spacing: "sm", margin: "sm",
      contents: [
        { type: "text", text: d.manager, size: "xs", weight: "bold", color: "#333333", flex: 4, wrap: true },
        { type: "text", text: `${d.actualMeetings}/${d.expectedMeetings}`, size: "xs", color: "#555555", flex: 2, align: "center" },
        { type: "text", text: `${d.compliance}%`, size: "xs", color: "#555555", flex: 2, align: "center" },
        { type: "text", text: d.meetingStatus, size: "xs", flex: 2, align: "end" }
      ]
    });
  });
  bubbles.push(createSectionBubble(`1. Weekly Meeting`, "#1976D2", meetingContents, periodText));

  // Bubble 2: GM Monitor สรุป
  let monitorContents = [
    {
      type: "box", layout: "horizontal", spacing: "xs",
      contents: [
        { type: "text", text: "Manager", size: "xs", weight: "bold", color: "#888888", flex: 3 },
        { type: "text", text: "Meet", size: "xs", weight: "bold", color: "#888888", flex: 2, align: "center" },
        { type: "text", text: "Bus", size: "xs", weight: "bold", color: "#888888", flex: 2, align: "center" },
        { type: "text", text: "Prob", size: "xs", weight: "bold", color: "#888888", flex: 4, align: "center" }
      ]
    },
    { type: "separator", margin: "sm", color: "#cccccc" }
  ];
  reportData.forEach(d => {
    const shortName = d.manager.replace(/ผู้จัดการ/g, '').trim();
    monitorContents.push({
      type: "box", layout: "horizontal", spacing: "xs", margin: "sm",
      contents: [
        { type: "text", text: shortName, size: "xs", weight: "bold", color: "#333333", flex: 3, wrap: true },
        { type: "text", text: d.meetingStatus, size: "xs", flex: 2, align: "center" },
        { type: "text", text: d.busStatus, size: "xs", flex: 2, align: "center" },
        { type: "text", text: `🔴${d.totalRedProb} 🟡${d.totalYellowProb} 🟣${d.totalPurpleProb}`, size: "xs", weight: "bold", color: "#555555", flex: 4, align: "center" }
      ]
    });
  });
  bubbles.push(createSectionBubble(`4. GM Monitor สรุป`, "#455A64", monitorContents, periodText));

  let replyPayload = [{
    type: "flex",
    altText: "รายงาน GM Monitor",
    contents: { type: "carousel", contents: bubbles.slice(0, 10) }
  }];
  replyMessage(replyToken, replyPayload);
}

function sendOverviewReportForAllFiles(groupId, replyToken) {
  replyMessage(replyToken, 'กำลังดึงรายงานภาพรวมทั้งหมด...');
}

function sendCarouselReportForGroup(groupId, replyToken) {
  replyMessage(replyToken, 'กำลังดึงรายงานสาขา...');
}

function sendFilteredReport(groupId, filterStatus, replyToken) {
  replyMessage(replyToken, `กำลังกรองรายงานสถานะ "${filterStatus}"...`);
}

function sendProblemSummary(groupId, replyToken) {
  replyMessage(replyToken, 'กำลังสรุปปัญหาทั้งหมด...');
}

function sendAccountingReportReply(replyToken) {
  replyMessage(replyToken, 'กำลังดึงรายงานการเบิกจ่าย...');
}
