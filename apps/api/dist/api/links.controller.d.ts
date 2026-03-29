import { LinkingService } from '../traceability/linking.service';
import { CreateManualLinkDto } from '../common/dto';
export declare class LinksController {
    private readonly linkingService;
    constructor(linkingService: LinkingService);
    createManualLink(body: CreateManualLinkDto): Promise<{
        data: void;
    }>;
    removeLink(id: string): Promise<{
        data: {
            deleted: boolean;
        };
    }>;
}
//# sourceMappingURL=links.controller.d.ts.map