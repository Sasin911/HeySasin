--// Wait for game to load \\--
if not game:IsLoaded() then
    game.Loaded:Wait()
end

--// Variables \\--
local BridgeURL = getgenv().BridgeURL or ... or "localhost:16384"

--// Libraries \\--

-- Lua 5.1+ base64 v3.0 (c) 2009 by Alex Kloss <alexthkloss@web.de>
-- licensed under the terms of the LGPL2

-- character table string
local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

-- encoding
function base64_encode(data)
    return ((data:gsub('.', function(x) 
        local r,b='',x:byte()
        for i=8,1,-1 do r=r..(b%2^i-b%2^(i-1)>0 and '1' or '0') end
        return r;
    end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
        if (#x < 6) then return '' end
        local c=0
        for i=1,6 do c=c+(x:sub(i,i)=='1' and 2^(6-i) or 0) end
        return b:sub(c+1,c+1)
    end)..({ '', '==', '=' })[#data%3+1])
end

--// Functions \\--
local function CreateDecompileFunction(id, options)
    local Endpoint = options.Endpoint
    local EncodingCallback = options.EncodeBytecode or function(x) return x end
    local FailedRequestCallback = options.FailedRequestCallback or function(httpResult) return `-- Failed to decompile, error:\n\n--[[\n{httpResult}\n--]]` end

    return function(scriptPath: Script | ModuleScript | LocalScript): string
        local okBytecode: boolean, bytecode: string = pcall(getscriptbytecode, scriptPath)

        if not okBytecode then
            return `-- Failed to get script bytecode, error:\n\n--[[\n{bytecode}\n--]]`
        end

        local okRequest: boolean, httpResult = pcall(request, {
            Url = Endpoint,
            Method = "POST",
            Body = EncodingCallback(bytecode),
            Headers = {
                ["Content-Type"] = "text/plain"
            },
        })

        if not okRequest then
            return FailedRequestCallback(httpResult, scriptPath)
        end

        if httpResult.StatusCode ~= 200 then
            return FailedRequestCallback(httpResult, scriptPath)
        end

        return `-- Decompiled with {id}\n{string.gsub(httpResult.Body, string.char(0x00CD), " ")}`
    end
end

local LuaEncode = loadstring(game:HttpGet("https://raw.githubusercontent.com/chadhyatt/LuaEncode/refs/heads/master/src/LuaEncode.lua"))()
local cloneref = cloneref or function(x) return x end

local KonstantDecompile = CreateDecompileFunction("Konstant", { Endpoint = "http://api.plusgiant5.com/konstant/decompile" })
local MedalDecompile = CreateDecompileFunction("Medal", {
    Endpoint = "https://medal.upio.dev/decompile",
    EncodingCallback = base64_encode,
    FailedRequestCallback = function(_, path)
        return KonstantDecompile(path)
    end
})

local LuaExpertLastCall = 0
local LuaExpertDecompile = function(scriptPath: Script | ModuleScript | LocalScript): string
    local okBytecode, bytecode = pcall(getscriptbytecode, scriptPath)
    if not okBytecode then
        return `-- Failed to get script bytecode, error:\n\n--[[\n{bytecode}\n--]]`
    end

    -- Rate limit: lua.expert requires ~120ms between requests
    local elapsed = os.clock() - LuaExpertLastCall
    if elapsed < 0.12 then
        task.wait(0.12 - elapsed)
    end

    local okRequest, httpResult = pcall(request, {
        Url = "https://api.lua.expert/decompile",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json"
        },
        Body = game:GetService("HttpService"):JSONEncode({
            script = base64_encode(bytecode)
        }),
    })

    LuaExpertLastCall = os.clock()

    if not okRequest or httpResult.StatusCode ~= 200 then
        return MedalDecompile(scriptPath)
    end

    return `-- Decompiled with lua.expert\n{httpResult.Body}`
end

local decompile = decompile or LuaExpertDecompile
local getnilinstances = getnilinstances or function() return {} end
local getscriptbytecode = getscriptbytecode or function(x) error("Unable to get script bytecode.") end

--// Services \\--
local RobloxReplicatedStorage = cloneref(game:GetService("RobloxReplicatedStorage"))
local VirtualInputManager = cloneref(Instance.new("VirtualInputManager"))
local MarketplaceService = cloneref(game:GetService("MarketplaceService"))
local CoreGui = cloneref(game:GetService("CoreGui"))
local CorePackages = cloneref(game:GetService("CorePackages"))
local ScriptContext = cloneref(game:GetService("ScriptContext"))
local HttpService = cloneref(game:GetService("HttpService"))
local LogService = cloneref(game:GetService("LogService"))
local Players = cloneref(game:GetService("Players"))

--// Compatibility Check \\--
local WebSocketAvailable = (
    typeof(WebSocket) ~= "nil" and
    typeof(WebSocket.connect) == "function"
) and (getgenv().DisableWebSocket ~= true)

--// Registration Info \\--
local function GetRegistrationInfo()
    local player = Players.LocalPlayer
    local placeName = "Unknown"
    pcall(function()
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)
        placeName = productInfo.Name
    end)
    return {
        type = "register",
        username = player and player.Name or "Unknown",
        userId = player and player.UserId or 0,
        placeId = game.PlaceId,
        jobId = game.JobId,
        placeName = placeName,
    }
end

--// Base Bridge Class \\--
local BaseBridge = {}; do
    BaseBridge.__index = BaseBridge
    
    function BaseBridge:BindToType(type, callback)
        self.Callbacks[type] = callback
    end

    function BaseBridge:BindToTypeRaw(type, callback)
        self.Callbacks[type] = callback
        self.RawCallbacks = self.RawCallbacks or {}
        self.RawCallbacks[type] = true
    end

    function BaseBridge:CreateAlias(type, aliases)
        for _, alias in aliases do
            self.Callbacks[alias] = self.Callbacks[type]
            if self.RawCallbacks and self.RawCallbacks[type] then
                self.RawCallbacks[alias] = true
            end
        end
    end

    function BaseBridge:HandleMessage(data)
        if self.Callbacks[data.type] then
            local success, result = pcall(function()
                return self.Callbacks[data.type](data)
            end)

            if success and result == nil then
                return nil
            end

            if not success then
                return self:FormatResponse(result, data.id, true)
            end

            if self.RawCallbacks and self.RawCallbacks[data.type] then
                return {
                    output = tostring(result),
                    success = true,
                    id = data.id
                }
            end

            return self:FormatResponse(result, data.id, false)
        end
        return nil
    end
    
    function BaseBridge:FormatResponse(message, id, isError)
        if isError then
            return {
                error = tostring(message),
                success = false,
                id = id
            }
        end
        
        local output = message
        if typeof(output) ~= "table" then
            output = { output }
        end
    
        return {
            output = LuaEncode(output, {
                Prettify = true
            }),
            success = true,
            id = id
        }
    end
    
    function BaseBridge:IsAlive()
        local success, result = pcall(function()
            local response
            local thread = task.spawn(function()
                local success, data = pcall(request, {
                    Url = "http://" .. BridgeURL,
                    Method = "GET"
                })

                if success then
                    response = data
                end
            end)

            local start = os.clock()
            repeat task.wait(0.05) until response ~= nil or os.clock() - start > 5

            if response == nil then
                task.cancel(thread)
                return false
            end
    
            -- 426 = Upgrade Required (WebSocket), 200 = HTTP mode
            if response.StatusCode == 426 or response.StatusCode == 200 then
                return true
            end
    
            return false
        end)
    
        if not success then
            return false
        end
    
        return result
    end
end

--// WebSocket Bridge \\--
local WebSocketBridge = setmetatable({}, {__index = BaseBridge}); do
    WebSocketBridge.__index = WebSocketBridge
    
    function WebSocketBridge.new()
        local self = setmetatable({}, WebSocketBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        --// Connect to the server with timeout \\--
        local wsConnection = nil
        local connectionThread = task.spawn(function()
            local success, result = pcall(function()
                return WebSocket.connect("ws://" .. BridgeURL)
            end)
            if success then
                wsConnection = result
            end
        end)
        
        local connectionStart = os.clock()
        repeat task.wait(0.05) until wsConnection ~= nil or os.clock() - connectionStart > 5
        
        if wsConnection == nil then
            task.cancel(connectionThread)
            error("WebSocket connection timed out after 5 seconds")
        end
        
        self.WebSocket = wsConnection
        self.Connected = true
        self.Callbacks = {}
        self.ClientId = nil

        --// Send registration \\--
        self.WebSocket:Send(HttpService:JSONEncode(GetRegistrationInfo()))

        self.AliveThread = task.spawn(function()
            local consecutiveFailures = 0
            while task.wait(1) do
                if not self.Connected then
                    continue
                end

                if self:IsAlive() then
                    consecutiveFailures = 0
                    continue
                end

                consecutiveFailures += 1
                if consecutiveFailures < 3 then
                    continue
                end
                
                self.Connected = false
                break
            end
    
            pcall(function()
                self.WebSocket:Close()
            end)
        end)
    
        --// On Message \\--
        self.WebSocket.OnMessage:Connect(function(message)
            local data = HttpService:JSONDecode(message)

            --// Handle registration response \\--
            if data.type == "registered" then
                self.ClientId = data.clientId
                return
            end

            local response = self:HandleMessage(data)
            if response then
                self.WebSocket:Send(HttpService:JSONEncode(response))
            end
        end)
    
        --// On Close \\--
        self.WebSocket.OnClose:Connect(function()
            self.Connected = false
        end)
    
        return self
    end
    
    function WebSocketBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// HTTP Polling Bridge \\--
local HTTPBridge = setmetatable({}, {__index = BaseBridge}); do
    HTTPBridge.__index = HTTPBridge
    
    function HTTPBridge.new()
        local self = setmetatable({}, HTTPBridge)
    
        --// Yield until the server is alive with exponential backoff \\--
        local retryDelay = 0.5
        local maxRetryDelay = 5
        local maxAttempts = 10
        local attempts = 0
        
        while not self:IsAlive() do
            attempts += 1
            if attempts >= maxAttempts then
                error("Failed to connect to bridge server after " .. maxAttempts .. " attempts")
            end
            task.wait(retryDelay)
            retryDelay = math.min(retryDelay * 1.5, maxRetryDelay)
        end
    
        self.Connected = true
        self.Callbacks = {}
        self.PollInterval = 0.1
        self.ClientId = nil

        --// Register with the server \\--
        pcall(function()
            local regResponse = request({
                Url = "http://" .. BridgeURL .. "/register",
                Method = "POST",
                Headers = { ["Content-Type"] = "application/json" },
                Body = HttpService:JSONEncode(GetRegistrationInfo()),
            })
            if regResponse.StatusCode == 200 and regResponse.Body then
                local regData = HttpService:JSONDecode(regResponse.Body)
                self.ClientId = regData.clientId
            end
        end)
    
        --// Start polling thread \\--
        self.PollThread = task.spawn(function()
            local consecutiveFailures = 0
            
            while self.Connected do
                local success, _ = pcall(function()
                    local pollUrl = "http://" .. BridgeURL .. "/poll"
                    if self.ClientId then
                        pollUrl = pollUrl .. "?clientId=" .. self.ClientId
                    end
                    local response = request({
                        Url = pollUrl,
                        Method = "GET"
                    })

                    --// Server might be down \\--
                    if response.StatusCode ~= 204 and response.StatusCode ~= 200 then
                        consecutiveFailures += 1
                        if consecutiveFailures >= 3 then
                            self.Connected = false
                        end

                        return
                    end
                    
                    consecutiveFailures = 0
    
                    --// Handle response \\--
                    if response.Body and response.Body ~= "" then
                        local data = HttpService:JSONDecode(response.Body)
                        if data == nil or data.type == nil then return end
                        
                        task.spawn(function()
                            local result = self:HandleMessage(data)
                            if result == nil then return end
                            
                            --// Send response back \\--
                            request({
                                Url = "http://" .. BridgeURL .. "/respond",
                                Method = "POST",
                                Headers = {
                                    ["Content-Type"] = "application/json"
                                },
                                Body = HttpService:JSONEncode(result)
                            })
                        end)
                    end
                end)
    
                if not success then
                    consecutiveFailures += 1
                    if consecutiveFailures >= 3 then
                        self.Connected = false
                    end
                end
    
                task.wait(self.PollInterval)
            end
        end)
    
        return self
    end
    
    function HTTPBridge:WaitForDisconnect()
        while self.Connected do
            task.wait(0.1)
        end
    end
end

--// Create Bridge \\--
local function CreateBridge()
    if WebSocketAvailable then
        local success, bridge = pcall(function()
            return WebSocketBridge.new()
        end)
        
        if success then
            return bridge
        end
    end

    return HTTPBridge.new()
end

--// Ratelimiter \\--

local Ratelimiter = {}
do
    type RatelimiterOptions = {
        Burst: {
            Time: number,
            Max: number
        },
    
        PeriodicInterval: number?,
        MainCallback: ((...any) -> ...any),
    }

    Ratelimiter.__index = Ratelimiter

    Ratelimiter.new = function(options: RatelimiterOptions)
        local self = setmetatable(options, Ratelimiter)
        self.Bucket = {}
        self.Queue = {}

        self.IsDestroyed = false
        self.ManagerThread = nil
        self.PeriodicThread = nil

        self:SetupManagerThread()

        return self
    end

    Ratelimiter.QueueOperation = function(self, ...: any)
        if self.IsDestroyed then return end
        table.insert(self.Queue, table.pack(...))
    end

    Ratelimiter.SetupManagerThread = function(self)
        if self.IsDestroyed then return end

        self.Bucket = {}
        self.Queue = {}

        if self.ManagerThread then
            task.cancel(self.ManagerThread)
            self.ManagerThread = nil
        end

        if self.PeriodicThread then
            task.cancel(self.PeriodicThread)
            self.PeriodicThread = nil
        end

        self.ManagerThread = task.spawn(function()
            while not self.IsDestroyed do
                local currentTime = tick()

                --// Clean bucket (efficient rebuild instead of O(n) removal) \\--
                if #self.Bucket > 0 then
                    local newBucket = {}
                    for _, time in self.Bucket do
                        if currentTime - time < self.Burst.Time then
                            table.insert(newBucket, time)
                        end
                    end

                    self.Bucket = newBucket
                end

                --// Process queue \\--
                while #self.Bucket < self.Burst.Max and #self.Queue > 0 do
                    local taskData = table.remove(self.Queue, 1)
                    if taskData then
                        table.insert(self.Bucket, tick())

                        task.defer(function()
                            if self.IsDestroyed then return end
                            self.MainCallback(table.unpack(taskData, 1, taskData.n))
                        end)
                    end
                end

                task.wait()
            end
        end)

        if not self.PeriodicInterval then return end
        self.PeriodicThread = task.spawn(function()
            while not self.IsDestroyed do
                self:QueueOperation()

                task.wait(self.PeriodicInterval)
            end
        end)
    end

    Ratelimiter.Destroy = function(self)
        if self.IsDestroyed then return end
        self.IsDestroyed = true

        if self.ManagerThread then
            task.cancel(self.ManagerThread)
            self.ManagerThread = nil
        end

        if self.PeriodicThread then
            task.cancel(self.PeriodicThread)
            self.PeriodicThread = nil
        end

        table.clear(self.Bucket)
        table.clear(self.Queue)
    end

    Ratelimiter.Stop = Ratelimiter.Destroy
end

--// Script Source Mapping \\--
local MappedScriptIds = {}
local QueuedScriptIds = {}
local ScriptInstanceMap = setmetatable({}, { __mode = "v" })
local SourcesToMap, SourcesProcessed, MappedSources = 0, 0, 0
local HasStartedMapping = false
local ScriptMappingFinished = false
local ScriptSourceUploadClientId = nil
local MappedSourceLimiter
local ScriptDescendantAddedConnection = nil
local UploadQueue = {}
local UploadQueueDebugIds = {}
local UploadQueueThread = nil
local UploadBatchMax = 8
local UploadFlushInterval = 0.5
local UploadMaxAttempts = 3
local BytecodeTimeoutSeconds = 3
local DecompileTimeoutSeconds = 12
local MarkScriptProcessed
local ActiveBridge = nil

local function IsScriptMappingTransportReady(clientId)
    return (
        ActiveBridge ~= nil and
        ActiveBridge.Connected == true and
        ActiveBridge.ClientId ~= nil and
        ActiveBridge.ClientId == clientId
    )
end

local function UploadScriptSourceBatch(clientId, scripts, hasFinishedMapping)
    if not clientId then return false end
    if not IsScriptMappingTransportReady(clientId) then return false end

    local ok, response = pcall(request, {
        Url = "http://" .. BridgeURL .. "/script-sources",
        Method = "POST",
        Headers = {
            ["Content-Type"] = "application/json"
        },
        Body = HttpService:JSONEncode({
            clientId = clientId,
            scripts = scripts or {},
            hasFinishedMapping = hasFinishedMapping,
            sourcesToMap = SourcesToMap,
            processedSources = SourcesProcessed,
            skippedSources = math.max(0, SourcesProcessed - MappedSources),
        })
    })

    return ok and response and response.StatusCode == 200
end

local function PublishScriptMappingStatus(hasFinishedMapping)
    if hasFinishedMapping ~= nil then
        ScriptMappingFinished = hasFinishedMapping
    end

    return UploadScriptSourceBatch(ScriptSourceUploadClientId, {}, ScriptMappingFinished)
end

local function StartUploadQueue()
    if UploadQueueThread then return end

    UploadQueueThread = task.spawn(function()
        while true do
            if #UploadQueue == 0 or not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then
                task.wait(UploadFlushInterval)
                continue
            end

            local batch = {}
            local debugIds = {}
            while #UploadQueue > 0 and #batch < UploadBatchMax do
                local item = table.remove(UploadQueue, 1)
                table.insert(batch, item)
                table.insert(debugIds, item.debugId)
                UploadQueueDebugIds[item.debugId] = nil
            end

            local uploaded = UploadScriptSourceBatch(ScriptSourceUploadClientId, batch, false)
            if uploaded then
                for _, debugId in debugIds do
                    MarkScriptProcessed(debugId, true)
                end
            else
                for idx = #batch, 1, -1 do
                    local item = batch[idx]
                    item.attempts = (item.attempts or 0) + 1
                    if item.attempts >= UploadMaxAttempts then
                        MarkScriptProcessed(item.debugId, false)
                    else
                        UploadQueueDebugIds[item.debugId] = item.debugId
                        table.insert(UploadQueue, 1, item)
                    end
                end
                task.wait(1)
            end

            task.wait()
        end
    end)
end

local function RunWithTimeout(timeoutSeconds, callback)
    local completed = false
    local success = false
    local result = nil

    local worker = task.spawn(function()
        success, result = pcall(callback)
        completed = true
    end)

    local deadline = os.clock() + timeoutSeconds
    while not completed and os.clock() < deadline do
        task.wait(0.05)
    end

    if not completed then
        pcall(task.cancel, worker)
        return false, "Timed out after " .. tostring(timeoutSeconds) .. "s."
    end

    if not success then
        return false, result
    end

    return true, result
end

local function DecompileScriptSource(script)
    local success, bytecode = RunWithTimeout(BytecodeTimeoutSeconds, function()
        return getscriptbytecode(script)
    end)
    if not success then return nil, bytecode end

    for attempt = 1, 3 do
        local success, decompOutput = RunWithTimeout(DecompileTimeoutSeconds, function()
            return decompile(script)
        end)
        if not success then
            if type(decompOutput) == "string" and string.find(decompOutput, "Timed out", 1, true) then
                return nil, decompOutput
            end

            task.wait(0.5)
            continue
        end

        return decompOutput
    end

    return nil, "Failed to decompile script after 3 attempts."
end

MarkScriptProcessed = function(debugId, uploaded)
    if MappedScriptIds[debugId] then return end

    MappedScriptIds[debugId] = true
    QueuedScriptIds[debugId] = nil
    SourcesProcessed += 1
    if uploaded then
        MappedSources += 1
    end

    if SourcesProcessed >= SourcesToMap then
        PublishScriptMappingStatus(true)
    end
end

local function MapScriptSource(script)
    local debugId = script:GetDebugId()
    if MappedScriptIds[debugId] then return end
    if not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then return end

    local source = DecompileScriptSource(script)
    if not source then
        MarkScriptProcessed(debugId, false)
        return
    end

    ScriptInstanceMap[debugId] = script
    script.Destroying:Once(function()
        ScriptInstanceMap[debugId] = nil
    end)

    if UploadQueueDebugIds[debugId] then return end
    UploadQueueDebugIds[debugId] = debugId
    table.insert(UploadQueue, {
        debugId = debugId,
        path = script:GetFullName(),
        source = source,
        attempts = 0,
    })
end

MappedSourceLimiter = Ratelimiter.new({
    Burst = {
        Time = 0.5,
        Max = 4,
    },

    MainCallback = MapScriptSource
})
MappedSourceLimiter:SetupManagerThread()

local function GetScriptByDebugId(debugId)
    local CachedInstance = ScriptInstanceMap[debugId]
    if CachedInstance then
        return CachedInstance
    end

    for _, script in game:QueryDescendants("LuaSourceContainer") do
        if script:IsA("Script") and script.RunContext == Enum.RunContext.Server then continue end
        if script:GetDebugId() ~= debugId then continue end
        
        ScriptInstanceMap[debugId] = script
        return script
    end

    for _, script in getnilinstances() do
        if not script:IsA("LuaSourceContainer") then continue end

        if script:IsA("Script") and script.RunContext ~= Enum.RunContext.Client then continue end
        if script:GetDebugId() ~= debugId then continue end
        
        ScriptInstanceMap[debugId] = script
        return script
    end

    return nil
end

local function ShouldMapScript(script)        
    local IsServerScript = (
        script:IsA("Script") and (
            script.RunContext == Enum.RunContext.Server or
            script.RunContext == Enum.RunContext.Legacy
        )
    )
    if IsServerScript then return false end

    local IsRobloxScript = (
        script.RobloxLocked or
        script:IsDescendantOf(CoreGui) or
        script:IsDescendantOf(CorePackages) or
        script:IsDescendantOf(ScriptContext)
    )
    if IsRobloxScript then return false end

    local debugId = script:GetDebugId()
    local IsAlreadyMapped = MappedScriptIds[debugId]
    if IsAlreadyMapped then return false end

    local IsAlreadyQueued = QueuedScriptIds[debugId]
    if IsAlreadyQueued then return false end

    local Success, Bytecode = pcall(getscriptbytecode, script)
    if not Success or Bytecode == nil then return false end

    return true
end

local function QueueScriptForMapping(script)
    if not IsScriptMappingTransportReady(ScriptSourceUploadClientId) then return end

    local debugId = script:GetDebugId()
    if MappedScriptIds[debugId] or QueuedScriptIds[debugId] then return end

    QueuedScriptIds[debugId] = true
    SourcesToMap += 1
    ScriptMappingFinished = false
    PublishScriptMappingStatus(false)
    MappedSourceLimiter:QueueOperation(script)
end

local function StartScriptMapping(clientId)
    if HasStartedMapping then return end
    if not IsScriptMappingTransportReady(clientId) then return end

    HasStartedMapping = true
    ScriptSourceUploadClientId = clientId

    ScriptDescendantAddedConnection = game.DescendantAdded:Connect(function(script)
        if not script:IsA("LuaSourceContainer") then
            return
        end

        if not ShouldMapScript(script) then return end
        QueueScriptForMapping(script)
    end)

    local CategoriesToMap = {
        game:QueryDescendants("LuaSourceContainer"),
        getnilinstances()
    }

    --// Map script sources \\--
    task.spawn(function()
        if not IsScriptMappingTransportReady(clientId) then return end

        local ValidScripts = {}
        for _, category in CategoriesToMap do
            for _, script in category do
                if not script:IsA("LuaSourceContainer") then continue end
                if not ShouldMapScript(script) then continue end

                QueuedScriptIds[script:GetDebugId()] = true
                table.insert(ValidScripts, script)
            end
        end

        SourcesToMap += #ValidScripts
        PublishScriptMappingStatus(false)

        for idx, scriptObject in ValidScripts do
            task.defer(MappedSourceLimiter.QueueOperation, MappedSourceLimiter, scriptObject)
            if idx % 250 == 0 then task.wait(0.1) end
        end

        if SourcesToMap == 0 then
            PublishScriptMappingStatus(true)
        end
    end)
end

local function ResetScriptMappingState(clientId)
    MappedScriptIds = {}
    QueuedScriptIds = {}
    SourcesToMap = 0
    SourcesProcessed = 0
    MappedSources = 0
    HasStartedMapping = false
    ScriptMappingFinished = false
    ScriptSourceUploadClientId = clientId

    if ScriptDescendantAddedConnection then
        ScriptDescendantAddedConnection:Disconnect()
        ScriptDescendantAddedConnection = nil
    end

    if MappedSourceLimiter then
        MappedSourceLimiter:SetupManagerThread()
    end

    table.clear(UploadQueue)
    table.clear(UploadQueueDebugIds)
end

local function WaitForBridgeClientId(Bridge)
    local deadline = os.clock() + 5
    repeat
        if Bridge.ClientId then
            return Bridge.ClientId
        end
        if not Bridge.Connected then
            return nil
        end
        task.wait(0.05)
    until os.clock() > deadline

    return nil
end

--// Main Loop \\--
while true do
    local success, Bridge = pcall(CreateBridge)
    
    if not success then
        task.wait(3)
        continue
    end

    local clientId = WaitForBridgeClientId(Bridge)
    if clientId then
        ActiveBridge = Bridge
        StartUploadQueue()

        if ScriptSourceUploadClientId ~= clientId then
            ResetScriptMappingState(clientId)
        end

        if not getgenv().DisableInitialScriptDecompMapping then
            StartScriptMapping(clientId)
        else
            HasStartedMapping = true
            ScriptSourceUploadClientId = clientId
            PublishScriptMappingStatus(true)
        end
    end

    Bridge:BindToType("execute", function(data)
        task.defer(function()
            setthreadidentity(8)
            loadstring(data.source)()
        end)
    end)

    Bridge:BindToTypeRaw("get-console-output", function(data)
        local limit = data.limit or 50
        local logsOrder = data.logsOrder or "NewestFirst"
        local filter = data.filter
        local hasFilter = typeof(filter) == "string" and filter ~= ""

        local logs = LogService:GetLogHistory()
        local results = {}
        local matchedCount = 0

        local function matchesFilter(logEntry)
            if not hasFilter then return true end
            return string.find(logEntry.message, filter, 1, true) ~= nil
        end

        local function escapeLogMessage(message)
            local output = tostring(message or "")
            output = string.gsub(output, "&", "&amp;")
            output = string.gsub(output, "<", "&lt;")
            output = string.gsub(output, ">", "&gt;")
            return output
        end

        if logsOrder == "NewestFirst" then
            for i = #logs, 1, -1 do
                local logEntry = logs[i]
                if not matchesFilter(logEntry) then continue end
                
                matchedCount += 1
                if #results < limit then
                    table.insert(results, logEntry)
                end
            end
        else
            for _, logEntry in logs do
                if not matchesFilter(logEntry) then continue end
                
                matchedCount += 1
                if #results < limit then
                    table.insert(results, logEntry)
                end
            end
        end

        local outputLines = {}
        table.insert(outputLines, string.format("Displaying %d/%d logs:", #results, matchedCount))

        for _, logEntry in results do
            table.insert(outputLines, string.format(
                '<log level="%s" time={%s}>%s</log>',
                logEntry.messageType.Name, tostring(logEntry.timestamp),
                escapeLogMessage(logEntry.message)
            ))
        end

        return table.concat(outputLines, "\n")
    end)

    Bridge:BindToType("get-data-by-code", function(data)
        setthreadidentity(8)
        local dataOutput = table.pack(loadstring(data.source)())

        return dataOutput
    end)

    Bridge:BindToTypeRaw("get-script-content", function(data)
        local source
        local scriptInstance

        --// Handle GC'd script proxies: debugId is passed directly, skip loadstring \\--
        if data.debugId then
            scriptInstance = GetScriptByDebugId(data.debugId)
            assert(scriptInstance, "No live script instance found for ScriptProxy with DebugId: " .. tostring(data.debugId))
        else
            setthreadidentity(8)
            scriptInstance = loadstring(data.source)()

            assert(typeof(scriptInstance) == "Instance", "Script instance is not an instance.")
            assert(scriptInstance:IsA("LuaSourceContainer"), "Script instance is not a LuaSourceContainer (Script, LocalScript, or ModuleScript).")
            assert(not (scriptInstance:IsA("Script") and scriptInstance.RunContext == Enum.RunContext.Server), "Script instance is a Server Script.")
        end

        source = DecompileScriptSource(scriptInstance)
        assert(source, "Failed to decompile script.")

        local debugId = scriptInstance:GetDebugId()
        if ScriptSourceUploadClientId and not MappedScriptIds[debugId] then
            local uploaded = UploadScriptSourceBatch(ScriptSourceUploadClientId, {
                {
                    debugId = debugId,
                    path = scriptInstance:GetFullName(),
                    source = source,
                }
            }, ScriptMappingFinished)

            if uploaded then
                MappedScriptIds[debugId] = true
            end
        end

        --// Line range support \\--
        if data.startLine then
            local lines = {}
            local pos = 1
            local len = #source
            while pos <= len do
                local newlinePos = source:find("\n", pos, true)
                if newlinePos then
                    table.insert(lines, source:sub(pos, newlinePos - 1))
                    pos = newlinePos + 1
                else
                    table.insert(lines, source:sub(pos))
                    break
                end
            end

            local totalLines = #lines
            local startLine = math.max(1, math.min(data.startLine, totalLines))
            local endLine = data.endLine and math.max(startLine, math.min(data.endLine, totalLines)) or totalLines

            local sliced = {}
            for i = startLine, endLine do
                table.insert(sliced, lines[i])
            end

            return "-- Lines " .. startLine .. "-" .. endLine .. " of " .. totalLines .. "\n" .. table.concat(sliced, "\n")
        end

        return source
    end)

    Bridge:BindToType("search-instances", function(data)
        local rootInstance = loadstring("return " .. data.root)()
        local instances = rootInstance:QueryDescendants(data.selector)
        
        local limit = data.limit or 50
        local results = {}
        
        for i, instance in instances do
            if i > limit then break end

            table.insert(results, {
                Name = instance.Name,
                ClassName = instance.ClassName,
                InstancePath = instance,
                DebugId = instance:GetDebugId()
            })
        end
        
        return {
            count = #instances,
            limited = #instances > limit,
            results = results
        }
    end)

    Bridge:BindToType("get-game-info", function(data)
        local productInfo = MarketplaceService:GetProductInfo(game.PlaceId)
        
        return {
            PlaceId = game.PlaceId,
            GameId = game.GameId,
            PlaceVersion = game.PlaceVersion,
            PlaceName = productInfo.Name,
            PlaceDescription = productInfo.Description,
            Creator = productInfo.Creator.Name,
            CreatorType = tostring(productInfo.Creator.CreatorType),
            CreatorId = productInfo.Creator.CreatorTargetId,
            JobId = game.JobId,
            ServerType = RobloxReplicatedStorage.GetServerType:InvokeServer()
        }
    end)

    Bridge:BindToType("get-descendants-tree", function(data)
        local rootInstance = loadstring("return " .. data.root)()
        assert(typeof(rootInstance) == "Instance", "Root path did not resolve to a valid Instance.")

        local maxDepth = data.maxDepth or 3
        local maxChildren = data.maxChildren or 50
        local classFilter = data.classFilter or ""
        local hasFilter = classFilter ~= ""

        local function buildTree(instance, depth)
            if depth > maxDepth then
                return nil
            end

            local children = instance:GetChildren()
            local childNodes = {}
            local shown = 0
            local total = #children

            for _, child in children do
                if shown >= maxChildren then break end

                if hasFilter and not child:IsA(classFilter) then
                    -- Even if this child doesn't match, check if any descendant might
                    -- Only skip if we're at max depth anyway
                    if depth < maxDepth then
                        local subtree = buildTree(child, depth + 1)
                        if subtree and subtree.Children and #subtree.Children > 0 then
                            table.insert(childNodes, subtree)
                            shown += 1
                        end
                    end
                    continue
                end

                local node = {
                    Name = child.Name,
                    ClassName = child.ClassName,
                    ChildCount = #child:GetChildren()
                }

                if depth < maxDepth and node.ChildCount > 0 then
                    local subtree = buildTree(child, depth + 1)
                    if subtree then
                        node.Children = subtree.Children
                    end
                end

                table.insert(childNodes, node)
                shown += 1
            end

            return {
                Name = instance.Name,
                ClassName = instance.ClassName,
                ChildCount = total,
                TruncatedAt = if shown < total then shown else nil,
                Children = childNodes
            }
        end

        return buildTree(rootInstance, 0)
    end)

    Bridge:BindToType("ensure-remote-spy", function(data)
        if getgenv().Cobalt then
            return {
                status = "already_loaded",
                message = "Cobalt remote spy is already running."
            }
        end

        -- Load Cobalt
        local success, err = pcall(function()
            loadstring(game:HttpGet("https://github.com/notpoiu/cobalt/releases/latest/download/Cobalt.luau"))()
        end)

        if not success then
            error("Failed to load Cobalt: " .. tostring(err))
        end

        -- Wait for Cobalt to initialize
        local waitStart = os.clock()
        while not getgenv().Cobalt and os.clock() - waitStart < 10 do
            task.wait(0.1)
        end
        
        return {
            status = "loaded",
            message = "Cobalt remote spy loaded successfully."
        }
    end)

    Bridge:BindToType("get-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local direction = data.direction or "Both"
        local nameFilter = data.remoteNameFilter or ""
        local limit = data.limit or 50
        local maxCallsPerRemote = data.maxCallsPerRemote or 5
        local hasNameFilter = nameFilter ~= ""

        local function ProcessLogs(logTable, directionLabel)
            local results = {}

            for instance, log in logTable do
                if typeof(instance) ~= "Instance" then continue end
                if #results >= limit then break end

                local remoteName = ""
                local remoteClass = ""
                pcall(function()
                    remoteName = instance.Name
                    remoteClass = instance.ClassName
                end)

                -- Apply name filter
                if hasNameFilter and not string.find(string.lower(remoteName), string.lower(nameFilter), 1, true) then
                    continue
                end

                -- Get recent calls (raw — LuaEncode handles serialization)
                local recentCalls = {}
                local totalCalls = #log.Calls
                local startIdx = math.max(1, totalCalls - maxCallsPerRemote + 1)

                for i = startIdx, totalCalls do
                    local call = log.Calls[i]
                    if not call then continue end

                    table.insert(recentCalls, {
                        Index = i,
                        Arguments = call.Arguments,
                        Origin = call.Origin,
                        IsExecutor = call.IsExecutor or false,
                        IsActor = call.IsActor or false,
                        Line = call.Line,
                    })
                end

                table.insert(results, {
                    RemoteName = remoteName,
                    RemoteClass = remoteClass,
                    Direction = directionLabel,
                    Method = log.Method,
                    TotalCalls = totalCalls,
                    Ignored = log.Ignored,
                    Blocked = log.Blocked,
                    RecentCalls = recentCalls,
                })
            end

            return results
        end

        local allResults = {}

        if direction == "Outgoing" or direction == "Both" then
            local outgoing = ProcessLogs(Cobalt.shared.Logs.Outgoing, "Outgoing")
            for _, r in outgoing do
                table.insert(allResults, r)
            end
        end

        if direction == "Incoming" or direction == "Both" then
            local incoming = ProcessLogs(Cobalt.shared.Logs.Incoming, "Incoming")
            for _, r in incoming do
                table.insert(allResults, r)
            end
        end

        -- Sort by total calls descending (most active remotes first)
        table.sort(allResults, function(a, b)
            return a.TotalCalls > b.TotalCalls
        end)

        -- Trim to limit
        if #allResults > limit then
            local trimmed = {}
            for i = 1, limit do
                trimmed[i] = allResults[i]
            end
            allResults = trimmed
        end

        return {
            count = #allResults,
            results = allResults
        }
    end)

    Bridge:BindToType("clear-remote-spy-logs", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.ClearLogs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        Cobalt.shared.ClearLogs()

        return {
            status = "cleared",
            message = "All remote spy logs have been cleared."
        }
    end)

    Bridge:BindToType("block-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local direction = data.direction
        local shouldBlock = data.shouldBlock

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            if name == remoteName then
                if shouldBlock and not log.Blocked then
                    log:Block()
                elseif not shouldBlock and log.Blocked then
                    log:Block() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldBlock and "Blocked" or "Unblocked") .. " remote: " .. remoteName,
                    blocked = log.Blocked
                }
            end
        end

        error("Remote not found: " .. remoteName .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    Bridge:BindToType("ignore-remote", function(data)
        local Cobalt = getgenv().Cobalt
        assert(Cobalt and Cobalt.shared and Cobalt.shared.Logs, "Cobalt remote spy is not loaded. Call ensure-remote-spy first.")

        local remoteName = data.remoteName
        local direction = data.direction
        local shouldIgnore = data.shouldIgnore

        local logTable = Cobalt.shared.Logs[direction]
        assert(logTable, "Invalid direction: " .. tostring(direction))

        for instance, log in logTable do
            if typeof(instance) ~= "Instance" then continue end

            local name = ""
            pcall(function() name = instance.Name end)

            if name == remoteName then
                if shouldIgnore and not log.Ignored then
                    log:Ignore()
                elseif not shouldIgnore and log.Ignored then
                    log:Ignore() -- toggles
                end

                return {
                    status = "success",
                    message = (shouldIgnore and "Ignoring" or "Unignored") .. " remote: " .. remoteName,
                    ignored = log.Ignored
                }
            end
        end

        error("Remote not found: " .. remoteName .. " in " .. direction .. " logs. Make sure the remote has been logged at least once.")
    end)

    Bridge:BindToType("type-text-box", function(data)
        local path = data.path
        local text = data.string or data.text
        local enter = data.enter
        local useKeyPress = data.useKeyPress

        local textBox
        if typeof(path) == "string" then
            textBox = loadstring("return " .. path)()
        else
            textBox = path
        end
        
        assert(typeof(textBox) == "Instance", "Path did not resolve to a valid Instance.")
        assert(textBox:IsA("TextBox"), "Resolved Instance is not a TextBox.")

        textBox:CaptureFocus()
        task.wait(0.05)
        
        if useKeyPress then
            local success = pcall(function()
                for i = 1, #text do
                    VirtualInputManager:SendTextInput(text:sub(i, i), nil, game)
                    task.wait(0.01)
                end
            end)
            
            if not success and type(keypress) == "function" then
                for i = 1, #text do
                    local char = text:sub(i, i):upper()
                    local byte = char:byte()
                    if byte then
                        keypress(byte)
                        task.wait(0.01)
                        if type(keyrelease) == "function" then
                            keyrelease(byte)
                        end
                    end
                end
            end
        else
            textBox.Text = text
        end

        if enter then
            if useKeyPress then
                if type(keypress) == "function" then
                    keypress(0x0D)
                    task.wait(0.01)
                    if type(keyrelease) == "function" then
                        keyrelease(0x0D)
                    end
                else
                    pcall(function()
                        VirtualInputManager:SendKeyEvent(true, Enum.KeyCode.Return, false, game)
                        task.wait(0.01)
                        VirtualInputManager:SendKeyEvent(false, Enum.KeyCode.Return, false, game)
                    end)
                end
            end
            textBox:ReleaseFocus(true)
        else
            textBox:ReleaseFocus(false)
        end

        return {
            status = "success",
            message = "Successfully typed into TextBox."
        }
    end)

    Bridge:BindToType("click-button", function(data)
        local path = data.path
        local action = data.Action or data.action

        local button
        if typeof(path) == "string" then
            button = loadstring("return " .. path)()
        else
            button = path
        end

        assert(typeof(button) == "Instance", "Path did not resolve to a valid Instance.")
        assert(button:IsA("GuiButton"), "Resolved Instance is not a GuiButton (e.g., TextButton or ImageButton).")
        assert(typeof(firesignal) == "function", "Your executor does not support 'firesignal', which is required for this command.")

        local Signals = {"Activated", "MouseButton1Down", "MouseButton2Down", "MouseButton1Click", "MouseButton2Click"}
        
        if action then
            assert(table.find(Signals, action), "Invalid action provided. Valid actions are: " .. table.concat(Signals, ", "))
            firesignal(button[action])
        else
            for _, signalName in pairs(Signals) do
                pcall(function() firesignal(button[signalName]) end)
            end
        end

        return {
            status = "success",
            message = "Successfully fired click signals on Button."
        }
    end)

    Bridge:WaitForDisconnect()

    if ActiveBridge == Bridge then
        ActiveBridge = nil
    end
    
    task.wait(1)
end
