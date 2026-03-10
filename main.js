const fs = require("fs");


function parseTimeToSeconds(timeStr) {
    timeStr = timeStr.trim().toLowerCase();
    const hasPeriod = timeStr.includes("am") || timeStr.includes("pm");
    const isPM = timeStr.includes("pm");
    const isAM = timeStr.includes("am");
    const timePart = timeStr.replace("am", "").replace("pm", "").trim();
    let [h, m, s] = timePart.split(":").map(Number);
    if (hasPeriod) {
        if (isPM && h !== 12) h += 12;
        if (isAM && h === 12) h = 0;
    }
    return h * 3600 + m * 60 + s;
}


function secondsToHMS(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


function hmsTOSeconds(hmsStr) {
    const [h, m, s] = hmsStr.trim().split(":").map(Number);
    return h * 3600 + m * 60 + s;
}


function getShiftDuration(startTime, endTime) {
    const startSecs = parseTimeToSeconds(startTime);
    const endSecs = parseTimeToSeconds(endTime);
    return secondsToHMS(endSecs - startSecs);
}


function getIdleTime(startTime, endTime) {
    const DELIVERY_START = 8 * 3600;   
    const DELIVERY_END = 22 * 3600;    

    const startSecs = parseTimeToSeconds(startTime);
    const endSecs = parseTimeToSeconds(endTime);

    let idleSecs = 0;

    
    if (startSecs < DELIVERY_START) {
        idleSecs += Math.min(DELIVERY_START, endSecs) - startSecs;
    }

    
    if (endSecs > DELIVERY_END) {
        idleSecs += endSecs - Math.max(DELIVERY_END, startSecs);
    }

    return secondsToHMS(idleSecs);
}


function getActiveTime(shiftDuration, idleTime) {
    const shiftSecs = hmsTOSeconds(shiftDuration);
    const idleSecs = hmsTOSeconds(idleTime);
    return secondsToHMS(shiftSecs - idleSecs);
}


function metQuota(date, activeTime) {
    const EID_START = new Date("2025-04-10");
    const EID_END = new Date("2025-04-30");
    const workDate = new Date(date);

    const NORMAL_QUOTA = 8 * 3600 + 24 * 60;   
    const EID_QUOTA = 6 * 3600;                  

    const quota = (workDate >= EID_START && workDate <= EID_END)
        ? EID_QUOTA
        : NORMAL_QUOTA;

    return hmsTOSeconds(activeTime) >= quota;
}


function addShiftRecord(textFile, shiftObj) {
    const { driverID, driverName, date, startTime, endTime } = shiftObj;

    let lines = fs.readFileSync(textFile, { encoding: "utf8" }).split("\n")
        .filter(l => l.trim() !== "");

    
    const duplicate = lines.find(l => {
        const cols = l.split(",");
        return cols[0].trim() === driverID && cols[2].trim() === date;
    });
    if (duplicate) return {};

    
    const shiftDuration = getShiftDuration(startTime, endTime);
    const idleTime = getIdleTime(startTime, endTime);
    const activeTime = getActiveTime(shiftDuration, idleTime);
    const quota = metQuota(date, activeTime);

    const newRecord = `${driverID},${driverName},${date},${startTime},${endTime},${shiftDuration},${idleTime},${activeTime},${quota},false`;

    
    let lastIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].split(",")[0].trim() === driverID) lastIndex = i;
    }

    if (lastIndex === -1) {
        lines.push(newRecord);
    } else {
        lines.splice(lastIndex + 1, 0, newRecord);
    }

    fs.writeFileSync(textFile, lines.join("\n") + "\n", { encoding: "utf8" });

    return {
        driverID,
        driverName,
        date,
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        shiftDuration,
        idleTime,
        activeTime,
        metQuota: quota,
        hasBonus: false
    };
}


function setBonus(textFile, driverID, date, newValue) {
    let lines = fs.readFileSync(textFile, { encoding: "utf8" }).split("\n");

    const updated = lines.map(line => {
        const cols = line.split(",");
        if (cols[0].trim() === driverID && cols[2].trim() === date) {
            cols[cols.length - 1] = String(newValue);
            return cols.join(",");
        }
        return line;
    });

    fs.writeFileSync(textFile, updated.join("\n"), { encoding: "utf8" });
}


function countBonusPerMonth(textFile, driverID, month) {
    const lines = fs.readFileSync(textFile, { encoding: "utf8" }).split("\n")
        .filter(l => l.trim() !== "");

    const driverLines = lines.filter(l => l.split(",")[0].trim() === driverID);
    if (driverLines.length === 0) return -1;

    const targetMonth = parseInt(month, 10);

    return driverLines.filter(l => {
        const cols = l.split(",");
        const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
        return recordMonth === targetMonth && cols[cols.length - 1].trim() === "true";
    }).length;
}


function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const lines = fs.readFileSync(textFile, { encoding: "utf8" }).split("\n")
        .filter(l => l.trim() !== "");

    let totalSecs = 0;

    lines.forEach(line => {
        const cols = line.split(",");
        if (cols[0].trim() !== driverID) return;
        const recordMonth = parseInt(cols[2].trim().split("-")[1], 10);
        if (recordMonth !== month) return;
        totalSecs += hmsTOSeconds(cols[7].trim());
    });

  
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const shifts = fs.readFileSync(textFile, { encoding: "utf8" }).split("\n")
        .filter(l => l.trim() !== "");
    const rates = fs.readFileSync(rateFile, { encoding: "utf8" }).split("\n")
        .filter(l => l.trim() !== "");

   
    const rateRow = rates.find(l => l.split(",")[0].trim() === driverID);
    const dayOff = rateRow ? rateRow.split(",")[1].trim().toLowerCase() : null;

    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

    const EID_START = new Date("2025-04-10");
    const EID_END = new Date("2025-04-30");
    const NORMAL_QUOTA = 8 * 3600 + 24 * 60;
    const EID_QUOTA = 6 * 3600;

    let totalSecs = 0;

    shifts.forEach(line => {
        const cols = line.split(",");
        if (cols[0].trim() !== driverID) return;
        const dateStr = cols[2].trim();
        const recordMonth = parseInt(dateStr.split("-")[1], 10);
        if (recordMonth !== month) return;

        const workDate = new Date(dateStr);
        const workDayName = dayNames[workDate.getDay()];

        
        if (dayOff && workDayName === dayOff) return;

       
        const quota = (workDate >= EID_START && workDate <= EID_END) ? EID_QUOTA : NORMAL_QUOTA;
        totalSecs += quota;
    });

    
    totalSecs -= bonusCount * 2 * 3600;
    if (totalSecs < 0) totalSecs = 0;

    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rates = fs.readFileSync(rateFile, { encoding: "utf8" }).split("\n")
        .filter(l => l.trim() !== "");

    const rateRow = rates.find(l => l.split(",")[0].trim() === driverID);
    const cols = rateRow.split(",");
    const basePay = parseInt(cols[2].trim(), 10);
    const tier = parseInt(cols[3].trim(), 10);

    const tierAllowance = { 1: 50, 2: 20, 3: 10, 4: 3 };
    const allowedMissingHours = tierAllowance[tier] || 0;

    const actualSecs = hmsTOSeconds(actualHours);
    const requiredSecs = hmsTOSeconds(requiredHours);

    if (actualSecs >= requiredSecs) return basePay;

    const missingSecs = requiredSecs - actualSecs;
    const missingHours = missingSecs / 3600;

    const billableMissingHours = missingHours - allowedMissingHours;
    if (billableMissingHours <= 0) return basePay;

    const billableFullHours = Math.floor(billableMissingHours);
    const deductionRatePerHour = Math.floor(basePay / 185);
    const salaryDeduction = billableFullHours * deductionRatePerHour;

    return basePay - salaryDeduction;
}

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};