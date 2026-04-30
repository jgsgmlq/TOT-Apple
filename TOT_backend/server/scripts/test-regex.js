const str = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="getTaskList">
<｜｜DSML｜｜parameter name="status" string="true">in_progress</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`;

const str2 = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name=“getTaskList”>
<｜｜DSML｜｜parameter name=“status” string=“true”>in_progress</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`;

const regex = /<｜｜DSML｜｜invoke\s+name=["“”]([^"“”]+)["“”]>[\s\S]*?(?:<｜｜DSML｜｜parameter\s+name=["“”]([^"“”]+)["“”]\s+string=["“”](true|false)["“”]>([^<]*)<\/｜｜DSML｜｜parameter>)?[\s\S]*?<\/｜｜DSML｜｜invoke>/;

console.log("str1 match:", !!str.match(regex));
console.log("str2 match:", !!str2.match(regex));
